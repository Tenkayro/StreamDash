package de.tenkayro.streamdash.companion

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.ContextCompat
import androidx.core.os.LocaleListCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.materialswitch.MaterialSwitch
import de.tenkayro.streamdash.companion.databinding.ActivityMainBinding
import de.tenkayro.streamdash.companion.databinding.BottomSheetSettingsBinding
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : AppCompatActivity() {

    private enum class ScreenMode {
        CONNECT,
        RECONNECT,
        WEBVIEW
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var store: ConnectionStore
    private val ioExecutor = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var screenMode = ScreenMode.CONNECT
    private var discoveredHosts: List<DiscoveredHost> = emptyList()
    private var selectedHost: DiscoveredHost? = null
    private var activeConnection: SavedConnection? = null
    private var manualExpanded = false
    private var activeScanCancel: AtomicBoolean? = null
    private var isScanning = false
    private var isConnecting = false
    private var reconnectScheduled = false
    private var isDestroyed = false
    private var availableUpdate: AppUpdateInfo? = null
    private var pendingInstallApk: File? = null
    private var isUpdating = false
    private var hostEventStream: HostEventStream? = null
    private var pendingTestAlertAfterPermission = false
    private var openSettingsBinding: BottomSheetSettingsBinding? = null
    private var suppressSettingsUiEvents = false
    private var explicitNotificationPrompt = false

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val wasExplicit = explicitNotificationPrompt
        explicitNotificationPrompt = false
        if (!granted) {
            pendingTestAlertAfterPermission = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                wasExplicit &&
                !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
            ) {
                showOpenAppSettingsDialog()
            } else {
                Toast.makeText(this, R.string.notif_permission_denied, Toast.LENGTH_SHORT).show()
            }
        } else if (pendingTestAlertAfterPermission) {
            pendingTestAlertAfterPermission = false
            CompanionNotifier.sendTestNotification(this, store.getCompanionSettings())
            Toast.makeText(this, R.string.toast_test_alert_sent, Toast.LENGTH_SHORT).show()
        }
    }

    private val unknownSourcesLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        val apk = pendingInstallApk
        if (apk != null && apk.exists() && AppUpdater.canInstallPackages(this)) {
            pendingInstallApk = null
            launchApkInstaller(apk)
        }
    }

    private val reconnectRunnable = Runnable {
        reconnectScheduled = false
        if (!isDestroyed && screenMode == ScreenMode.RECONNECT) {
            attemptSavedConnection(isRetry = true)
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            startQrScanner()
        } else {
            showError(getString(R.string.err_camera_denied))
            if (!shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
                showOpenAppSettingsDialog()
            }
        }
    }

    private val qrScannerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != RESULT_OK) return@registerForActivityResult
        val raw = result.data?.getStringExtra(PortraitCaptureActivity.EXTRA_QR_RESULT)
            ?: return@registerForActivityResult
        val parsed = HostApi.parseQrUrl(raw)
        if (parsed == null) {
            showError(getString(R.string.err_invalid_qr))
            return@registerForActivityResult
        }
        binding.etManualHost.setText(parsed.host)
        binding.etManualPort.setText(parsed.port.toString())
        binding.etPairingCode.setText(parsed.token)
        clearError()
        connectTo(parsed.host, parsed.port, parsed.token)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        store = ConnectionStore(this)
        CompanionNotifier.createChannels(this)
        if (BuildConfig.DEBUG) {
            binding.tvModeBadge.text = "DEV"
        }
        applyKeepScreenOn(store.isKeepScreenOn())
        setupInsets()
        setupWebView()
        setupListeners()
        setupBackNavigation()

        binding.etManualPort.setText(store.getDefaultHostPort().toString())

        val saved = store.loadConnection()
        if (saved != null) {
            activeConnection = saved
            binding.etManualHost.setText(saved.host)
            binding.etManualPort.setText(saved.port.toString())
            binding.etPairingCode.setText(saved.token)
            if (store.isAutoReconnect()) {
                showReconnectScreen(saved)
                attemptSavedConnection(isRetry = false)
            } else {
                switchScreen(ScreenMode.CONNECT)
                triggerLanDiscovery()
            }
        } else {
            switchScreen(ScreenMode.CONNECT)
            triggerLanDiscovery()
        }

        if (!BuildConfig.DEBUG && AppUpdater.shouldAutoCheck(this)) {
            checkForUpdates(manual = false)
        }
    }

    override fun onResume() {
        super.onResume()
        applyKeepScreenOn(store.isKeepScreenOn())
    }

    override fun onDestroy() {
        isDestroyed = true
        activeScanCancel?.set(true)
        stopHostEventStream()
        cancelReconnectLoop()
        openSettingsBinding = null
        binding.webView.destroy()
        ioExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun setupInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(binding.rootContainer) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
            )
            view.updatePadding(
                left = bars.left,
                top = bars.top,
                right = bars.right,
                bottom = bars.bottom
            )
            insets
        }
    }

    private fun setupListeners() {
        binding.btnHeaderMenu.setOnClickListener {
            triggerTapHaptic(it)
            showSettingsSheet()
        }
        binding.btnReconnectMenu.setOnClickListener {
            triggerTapHaptic(it)
            showSettingsSheet()
        }
        binding.btnQuickMenu.setOnClickListener {
            triggerTapHaptic(it)
            showSettingsSheet()
        }

        binding.btnScanQr.setOnClickListener {
            triggerTapHaptic(it)
            clearError()
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED
            ) {
                startQrScanner()
            } else {
                requestPermissionWithRationale(
                    permission = Manifest.permission.CAMERA,
                    titleRes = R.string.permission_camera_rationale_title,
                    messageRes = R.string.permission_camera_rationale_msg,
                    launcher = cameraPermissionLauncher
                )
            }
        }

        binding.btnRefreshLan.setOnClickListener {
            triggerTapHaptic(it)
            triggerLanDiscovery()
        }

        binding.btnToggleManual.setOnClickListener {
            triggerTapHaptic(it)
            setManualExpanded(!manualExpanded)
        }

        binding.btnConnect.setOnClickListener {
            triggerTapHaptic(it)
            handleManualOrDiscoveredConnect()
        }

        binding.etPairingCode.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                handleManualOrDiscoveredConnect()
                true
            } else {
                false
            }
        }

        binding.btnRetryNow.setOnClickListener {
            triggerTapHaptic(it)
            cancelReconnectLoop()
            attemptSavedConnection(isRetry = true)
        }

        binding.btnSwitchPc.setOnClickListener {
            triggerTapHaptic(it)
            disconnectToPairingScreen(clearSaved = false)
        }

        binding.btnInstallUpdate.setOnClickListener {
            triggerTapHaptic(it)
            availableUpdate?.let(::promptInstallUpdate)
        }

        binding.swipeRefresh.setColorSchemeColors(
            ContextCompat.getColor(this, R.color.accent_violet)
        )
        binding.swipeRefresh.setProgressBackgroundColorSchemeColor(
            ContextCompat.getColor(this, R.color.obsidian_surface)
        )
        binding.swipeRefresh.setOnRefreshListener {
            binding.webView.reload()
        }
        // Only enable pull-to-refresh when WebView is scrolled to top so internal lists scroll smoothly
        binding.swipeRefresh.setOnChildScrollUpCallback { _, _ ->
            binding.webView.scrollY > 0
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (screenMode == ScreenMode.WEBVIEW && binding.webView.canGoBack()) {
                    binding.webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(binding.webView, true)

        binding.webView.setBackgroundColor(Color.parseColor("#111317"))
        binding.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = false
            allowContentAccess = false
            safeBrowsingEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        binding.webView.webChromeClient = WebChromeClient()
        binding.webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                val conn = activeConnection ?: store.loadConnection()
                if (conn != null && HostApi.isHostDashboardUrl(uri.toString(), conn.host, conn.port)) {
                    return false
                }
                val scheme = uri.scheme?.lowercase().orEmpty()
                if (scheme == "http" || scheme == "https") {
                    runCatching {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    }
                }
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                binding.swipeRefresh.isRefreshing = false
                CookieManager.getInstance().flush()
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true && screenMode == ScreenMode.WEBVIEW) {
                    binding.swipeRefresh.isRefreshing = false
                    val conn = activeConnection ?: return
                    showReconnectScreen(conn)
                    scheduleReconnect()
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request?.isForMainFrame == true && errorResponse != null) {
                    if (errorResponse.statusCode == 401 || errorResponse.statusCode == 403) {
                        disconnectToPairingScreen(
                            clearSaved = true,
                            initialError = getString(R.string.err_token_rotated)
                        )
                    } else if (errorResponse.statusCode >= 500 && screenMode == ScreenMode.WEBVIEW) {
                        val conn = activeConnection ?: return
                        showReconnectScreen(conn)
                        scheduleReconnect()
                    }
                }
            }
        }
    }

    private fun startQrScanner() {
        qrScannerLauncher.launch(Intent(this, PortraitCaptureActivity::class.java))
    }

    private fun setManualExpanded(expanded: Boolean) {
        manualExpanded = expanded
        binding.manualHostSection.visibility = if (expanded) View.VISIBLE else View.GONE
        binding.btnToggleManual.setText(
            if (expanded) R.string.toggle_manual_hide else R.string.toggle_manual_show
        )
    }

    private fun triggerLanDiscovery() {
        activeScanCancel?.set(true)
        val cancelFlag = AtomicBoolean(false)
        activeScanCancel = cancelFlag

        isScanning = true
        binding.rowScanning.visibility = View.VISIBLE
        binding.emptyPcsBox.visibility = View.GONE
        binding.btnRefreshLan.isEnabled = false
        binding.btnRefreshLan.alpha = 0.65f
        updateLanStatusDot(scanning = true, hostsCount = discoveredHosts.size)

        val knownHints = buildList {
            addAll(store.getRecentHosts())
            val typedHost = binding.etManualHost.text.toString().trim()
            val typedPort = binding.etManualPort.text.toString().trim().toIntOrNull()
                ?: store.getDefaultHostPort()
            if (typedHost.isNotEmpty()) {
                add(KnownHostHint(typedHost, typedPort))
            }
        }
        val candidatePorts = buildList {
            add(HostApi.DEFAULT_PORT)
            add(store.getDefaultHostPort())
            binding.etManualPort.text.toString().trim().toIntOrNull()?.let { add(it) }
        }

        ioExecutor.execute {
            val results = LanDiscovery.discover(
                context = applicationContext,
                knownHosts = knownHints,
                candidatePorts = candidatePorts,
                timeoutMs = 1750,
                cancelFlag = cancelFlag,
                onUpdate = { partial ->
                    mainHandler.post {
                        if (isDestroyed || cancelFlag.get()) return@post
                        applyDiscoveredHosts(partial, stillScanning = true)
                    }
                }
            )
            mainHandler.post {
                if (isDestroyed || cancelFlag.get()) return@post
                isScanning = false
                binding.rowScanning.visibility = View.GONE
                binding.btnRefreshLan.isEnabled = true
                binding.btnRefreshLan.alpha = 1f
                applyDiscoveredHosts(results, stillScanning = false)
            }
        }
    }

    private fun applyDiscoveredHosts(results: List<DiscoveredHost>, stillScanning: Boolean) {
        discoveredHosts = results
        if (results.size == 1 && selectedHost == null) {
            selectedHost = results.first()
        } else if (selectedHost != null) {
            selectedHost = results.find {
                it.ip == selectedHost?.ip && it.port == selectedHost?.port
            }
        }
        updateLanStatusDot(scanning = stillScanning, hostsCount = results.size)
        renderDiscoveredHosts(stillScanning)
    }

    private fun updateLanStatusDot(scanning: Boolean, hostsCount: Int) {
        val colorRes = when {
            hostsCount > 0 -> R.color.status_emerald
            scanning -> R.color.accent_violet
            !LanDiscovery.hasLanConnection(this) -> R.color.status_rose
            else -> R.color.text_muted
        }
        binding.lanStatusDot.backgroundTintList = ColorStateList.valueOf(
            ContextCompat.getColor(this, colorRes)
        )
    }

    private fun renderDiscoveredHosts(stillScanning: Boolean = isScanning) {
        val container = binding.discoveredListContainer
        container.removeAllViews()

        if (discoveredHosts.isEmpty()) {
            if (!stillScanning) {
                val hasWifi = LanDiscovery.hasLanConnection(this)
                binding.tvNoPcsFound.setText(
                    if (hasWifi) R.string.no_pcs_found else R.string.no_pcs_wifi_off
                )
                binding.tvNoPcsHint.text = if (hasWifi) {
                    getString(R.string.no_pcs_hint, store.getDefaultHostPort())
                } else {
                    getString(R.string.no_pcs_wifi_hint)
                }
                binding.emptyPcsBox.visibility = View.VISIBLE
            } else {
                binding.emptyPcsBox.visibility = View.GONE
            }
            return
        }
        binding.emptyPcsBox.visibility = View.GONE

        val inflater = LayoutInflater.from(this)
        for (host in discoveredHosts) {
            val itemView = inflater.inflate(R.layout.item_discovered_host, container, false)
            val tvName = itemView.findViewById<TextView>(R.id.tvHostName)
            val tvEndpoint = itemView.findViewById<TextView>(R.id.tvHostEndpoint)
            val tvBadge = itemView.findViewById<TextView>(R.id.tvHostAuthBadge)

            tvName.text = host.hostName
            tvEndpoint.text = if (host.version.isNotEmpty()) {
                "${host.ip}:${host.port} · v${host.version}"
            } else {
                "${host.ip}:${host.port}"
            }
            tvBadge.setText(if (host.authRequired) R.string.badge_code_required else R.string.badge_no_code)
            tvBadge.setTextColor(
                ContextCompat.getColor(
                    this,
                    if (host.authRequired) R.color.accent_violet else R.color.status_emerald
                )
            )

            val isSelected = selectedHost?.ip == host.ip && selectedHost?.port == host.port
            itemView.setBackgroundResource(
                if (isSelected) R.drawable.bg_card_selected else R.drawable.bg_well
            )

            itemView.setOnClickListener {
                triggerTapHaptic(it)
                selectedHost = host
                binding.etManualHost.setText(host.ip)
                binding.etManualPort.setText(host.port.toString())
                clearError()
                renderDiscoveredHosts()
                if (!host.authRequired) {
                    connectTo(host.ip, host.port, "")
                } else {
                    binding.etPairingCode.requestFocus()
                }
            }
            container.addView(itemView)
        }
    }

    private fun handleManualOrDiscoveredConnect() {
        clearError()
        val token = binding.etPairingCode.text.toString().trim()
        val manualHost = binding.etManualHost.text.toString().trim()
        val manualPortStr = binding.etManualPort.text.toString().trim()

        if (selectedHost != null && (!manualExpanded || manualHost == selectedHost?.ip)) {
            val host = selectedHost!!
            connectTo(host.ip, host.port, token)
            return
        }

        if (manualHost.isNotEmpty()) {
            val port = manualPortStr.ifEmpty { store.getDefaultHostPort().toString() }.toIntOrNull()
            if (port == null || port !in 1..65535) {
                showError(getString(R.string.err_invalid_port))
                return
            }
            connectTo(manualHost, port, token)
            return
        }

        when (discoveredHosts.size) {
            1 -> {
                val only = discoveredHosts.first()
                selectedHost = only
                renderDiscoveredHosts()
                connectTo(only.ip, only.port, token)
            }
            in 2..Int.MAX_VALUE -> {
                showError(getString(R.string.err_multiple_pcs))
            }
            else -> {
                setManualExpanded(true)
                showError(getString(R.string.err_no_pc_selected))
            }
        }
    }

    private fun connectTo(host: String, port: Int, token: String) {
        if (isConnecting) return
        isConnecting = true
        binding.btnConnect.isEnabled = false
        binding.btnConnect.setText(R.string.connecting)
        clearError()

        ioExecutor.execute {
            val result = HostApi.verifyConnection(host, port, token)
            mainHandler.post {
                if (isDestroyed) return@post
                isConnecting = false
                binding.btnConnect.isEnabled = true
                binding.btnConnect.setText(R.string.btn_connect)

                when (result) {
                    is HostApi.VerifyResult.Success -> {
                        val saved = SavedConnection(
                            host = host.trim(),
                            port = port,
                            token = token.trim(),
                            hostName = result.hostName
                        )
                        store.saveConnection(saved)
                        activeConnection = saved
                        openDashboard(saved)
                    }
                    is HostApi.VerifyResult.CodeRequired -> {
                        showError(getString(R.string.err_code_required))
                        binding.etPairingCode.requestFocus()
                    }
                    is HostApi.VerifyResult.InvalidToken -> {
                        showError(getString(R.string.err_invalid_code))
                        binding.etPairingCode.requestFocus()
                    }
                    is HostApi.VerifyResult.Unreachable -> {
                        showError(getString(R.string.err_pc_unreachable, host, port))
                    }
                }
            }
        }
    }

    private fun attemptSavedConnection(isRetry: Boolean) {
        val conn = activeConnection ?: return
        ioExecutor.execute {
            val result = HostApi.verifyConnection(conn.host, conn.port, conn.token)
            mainHandler.post {
                if (isDestroyed || screenMode != ScreenMode.RECONNECT) return@post
                when (result) {
                    is HostApi.VerifyResult.Success -> {
                        val updated = conn.copy(hostName = result.hostName)
                        store.saveConnection(updated)
                        activeConnection = updated
                        openDashboard(updated)
                    }
                    is HostApi.VerifyResult.InvalidToken,
                    is HostApi.VerifyResult.CodeRequired -> {
                        disconnectToPairingScreen(
                            clearSaved = true,
                            initialError = getString(R.string.err_token_rotated)
                        )
                    }
                    is HostApi.VerifyResult.Unreachable -> {
                        if (isRetry) {
                            // Keep retrying calmly while waiting
                        }
                        scheduleReconnect()
                    }
                }
            }
        }
    }

    private fun scheduleReconnect() {
        if (reconnectScheduled || isDestroyed) return
        reconnectScheduled = true
        mainHandler.postDelayed(reconnectRunnable, 3000L)
    }

    private fun cancelReconnectLoop() {
        reconnectScheduled = false
        mainHandler.removeCallbacks(reconnectRunnable)
    }

    private fun openDashboard(conn: SavedConnection) {
        activeScanCancel?.set(true)
        cancelReconnectLoop()
        switchScreen(ScreenMode.WEBVIEW)
        applyKeepScreenOn(store.isKeepScreenOn())
        val url = HostApi.buildDashboardUrl(conn.host, conn.port, conn.token)
        binding.webView.loadUrl(url)
        startHostEventStream(conn)
        syncCompanionSettingsWithHost(conn)
        maybePromptNotificationPermission()
        if (BuildConfig.DEBUG) {
            checkForUpdates(manual = false)
        }
    }

    private fun startHostEventStream(conn: SavedConnection) {
        stopHostEventStream()
        val stream = HostEventStream(conn.host, conn.port, conn.token) { rawJson ->
            mainHandler.post {
                if (isDestroyed) return@post
                CompanionNotifier.handleIncomingEvent(
                    context = this,
                    settings = store.getCompanionSettings(),
                    rawJson = rawJson,
                    onSettingsUpdated = { incoming ->
                        if (store.hasPendingCompanionSync()) return@handleIncomingEvent
                        store.saveCompanionSettings(incoming, pendingHostSync = false)
                        applyKeepScreenOn(incoming.keepScreenOn)
                        openSettingsBinding?.let { sheet ->
                            applyCompanionSettingsToSheet(sheet, incoming)
                        }
                        applyLanguageTagIfNeeded(incoming.language)
                    }
                )
            }
        }
        hostEventStream = stream
        stream.start()
    }

    private fun stopHostEventStream() {
        hostEventStream?.stop()
        hostEventStream = null
    }

    private fun syncCompanionSettingsWithHost(conn: SavedConnection) {
        ioExecutor.execute {
            if (store.hasPendingCompanionSync()) {
                val local = store.getCompanionSettings()
                val pushed = HostApi.pushCompanionSettings(conn.host, conn.port, conn.token, local)
                if (pushed) {
                    store.setPendingCompanionSync(false)
                    mainHandler.post {
                        if (!isDestroyed) {
                            openSettingsBinding?.let { updateSyncBadgeUi(it) }
                        }
                    }
                }
            } else {
                val remote = HostApi.fetchCompanionSettings(conn.host, conn.port, conn.token)
                if (remote != null) {
                    mainHandler.post {
                        if (isDestroyed || store.hasPendingCompanionSync()) return@post
                        store.saveCompanionSettings(remote, pendingHostSync = false)
                        applyKeepScreenOn(remote.keepScreenOn)
                        openSettingsBinding?.let { sheet ->
                            applyCompanionSettingsToSheet(sheet, remote)
                        }
                        applyLanguageTagIfNeeded(remote.language)
                    }
                }
            }
        }
    }

    private fun maybePromptNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val settings = store.getCompanionSettings()
        if (!settings.notificationsEnabled || store.isNotificationPrompted()) return
        if (CompanionNotifier.hasNotificationPermission(this)) return
        store.markNotificationPrompted()
        requestNotificationPermission(explicit = false)
    }

    private fun requestNotificationPermission(explicit: Boolean) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        explicitNotificationPrompt = explicit
        requestPermissionWithRationale(
            permission = Manifest.permission.POST_NOTIFICATIONS,
            titleRes = R.string.permission_notif_rationale_title,
            messageRes = R.string.permission_notif_rationale_msg,
            launcher = notificationPermissionLauncher
        )
    }

    private fun requestPermissionWithRationale(
        permission: String,
        titleRes: Int,
        messageRes: Int,
        launcher: ActivityResultLauncher<String>
    ) {
        if (shouldShowRequestPermissionRationale(permission)) {
            MaterialAlertDialogBuilder(this)
                .setTitle(titleRes)
                .setMessage(messageRes)
                .setPositiveButton(R.string.permission_continue) { _, _ ->
                    launcher.launch(permission)
                }
                .setNegativeButton(R.string.update_btn_later, null)
                .show()
        } else {
            launcher.launch(permission)
        }
    }

    private fun showOpenAppSettingsDialog() {
        MaterialAlertDialogBuilder(this)
            .setMessage(R.string.permission_settings_prompt)
            .setPositiveButton(R.string.permission_open_settings) { _, _ ->
                runCatching {
                    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.fromParts("package", packageName, null)
                    }
                    startActivity(intent)
                }
            }
            .setNegativeButton(R.string.update_btn_later, null)
            .show()
    }

    private fun showReconnectScreen(conn: SavedConnection) {
        activeScanCancel?.set(true)
        stopHostEventStream()
        switchScreen(ScreenMode.RECONNECT)
        binding.tvReconnectTitle.text = getString(R.string.reconnect_title, conn.hostName)
        binding.tvReconnectSubtitle.text = getString(R.string.reconnect_subtitle, conn.host, conn.port)
    }

    private fun disconnectToPairingScreen(clearSaved: Boolean, initialError: String? = null) {
        cancelReconnectLoop()
        stopHostEventStream()
        if (clearSaved) {
            store.clearConnection()
            activeConnection = null
        }
        binding.webView.stopLoading()
        binding.webView.loadUrl("about:blank")
        applyKeepScreenOn(store.isKeepScreenOn())
        switchScreen(ScreenMode.CONNECT)
        if (initialError != null) {
            showError(initialError)
        } else {
            clearError()
        }
        triggerLanDiscovery()
    }

    private fun switchScreen(mode: ScreenMode) {
        screenMode = mode
        binding.panelConnect.visibility = if (mode == ScreenMode.CONNECT) View.VISIBLE else View.GONE
        binding.panelReconnect.visibility = if (mode == ScreenMode.RECONNECT) View.VISIBLE else View.GONE
        binding.panelWebView.visibility = if (mode == ScreenMode.WEBVIEW) View.VISIBLE else View.GONE
    }

    private fun showSettingsSheet() {
        val dialog = BottomSheetDialog(this)
        val sheet = BottomSheetSettingsBinding.inflate(layoutInflater)
        openSettingsBinding = sheet
        dialog.setContentView(sheet.root)
        dialog.setOnShowListener {
            dialog.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)
                ?.setBackgroundColor(Color.TRANSPARENT)
        }
        dialog.setOnDismissListener {
            if (openSettingsBinding == sheet) {
                openSettingsBinding = null
            }
        }

        val currentVersion = BuildConfig.VERSION_NAME.substringBefore("-")
        sheet.tvSheetVersion.text = if (BuildConfig.DEBUG) "v$currentVersion (DEV)" else "v$currentVersion"
        sheet.btnSheetClose.setOnClickListener {
            triggerTapHaptic(it)
            dialog.dismiss()
        }

        // Context-aware quick session actions when connected
        if (screenMode == ScreenMode.WEBVIEW) {
            sheet.sectionSheetQuickActions.visibility = View.VISIBLE
            sheet.btnSheetReload.setOnClickListener {
                triggerTapHaptic(it)
                dialog.dismiss()
                binding.webView.reload()
            }
            sheet.btnSheetSwitchPc.setOnClickListener {
                triggerTapHaptic(it)
                dialog.dismiss()
                disconnectToPairingScreen(clearSaved = false)
            }
        } else {
            sheet.sectionSheetQuickActions.visibility = View.GONE
        }

        fun updateCompanionSetting(
            viewForHaptic: View?,
            mutator: (CompanionSettings) -> CompanionSettings
        ): CompanionSettings {
            val next = mutator(store.getCompanionSettings()).normalized()
            CompanionNotifier.triggerUiHaptic(viewForHaptic, next)
            val conn = activeConnection ?: store.loadConnection()
            store.saveCompanionSettings(next, pendingHostSync = conn != null)
            applyCompanionSettingsToSheet(sheet, next)
            if (conn != null) {
                ioExecutor.execute {
                    val pushed = HostApi.pushCompanionSettings(conn.host, conn.port, conn.token, next)
                    if (pushed) {
                        store.setPendingCompanionSync(false)
                        mainHandler.post {
                            if (!isDestroyed && openSettingsBinding == sheet) {
                                updateSyncBadgeUi(sheet)
                            }
                        }
                    }
                }
            }
            return next
        }

        fun bindToggle(
            row: View,
            toggle: MaterialSwitch,
            mutator: (CompanionSettings, Boolean) -> CompanionSettings,
            afterChange: ((Boolean) -> Unit)? = null
        ) {
            toggle.setOnCheckedChangeListener { _, isChecked ->
                if (suppressSettingsUiEvents) return@setOnCheckedChangeListener
                updateCompanionSetting(row) { current -> mutator(current, isChecked) }
                afterChange?.invoke(isChecked)
            }
            row.setOnClickListener { toggle.isChecked = !toggle.isChecked }
        }

        applyCompanionSettingsToSheet(sheet, store.getCompanionSettings())

        // Language picker
        sheet.tvSettingLanguageValue.text = getCurrentLanguageDisplayName()
        sheet.rowSettingLanguage.setOnClickListener {
            triggerTapHaptic(it)
            dialog.dismiss()
            showLanguagePickerDialog()
        }

        // Keep screen on toggle
        bindToggle(
            sheet.rowSettingKeepScreenOn,
            sheet.switchKeepScreenOn,
            { current, next -> current.copy(keepScreenOn = next) }
        ) { next ->
            applyKeepScreenOn(next)
            Toast.makeText(
                this,
                if (next) R.string.toast_screen_awake_on else R.string.toast_screen_awake_off,
                Toast.LENGTH_SHORT
            ).show()
        }

        // Auto-reconnect toggle
        bindToggle(
            sheet.rowSettingAutoReconnect,
            sheet.switchAutoReconnect,
            { current, next -> current.copy(autoReconnect = next) }
        )

        // Default Host Port
        sheet.tvSettingDefaultPortValue.text = store.getDefaultHostPort().toString()
        sheet.rowSettingDefaultPort.setOnClickListener {
            triggerTapHaptic(it)
            dialog.dismiss()
            showDefaultPortDialog()
        }

        // Notifications & Event Categories
        bindToggle(
            sheet.rowSettingNotifications,
            sheet.switchNotificationsEnabled,
            { current, next -> current.copy(notificationsEnabled = next) }
        ) { enabled ->
            if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                !CompanionNotifier.hasNotificationPermission(this)
            ) {
                store.markNotificationPrompted()
                requestNotificationPermission(explicit = true)
            }
        }
        bindToggle(sheet.rowNotifyFollows, sheet.switchNotifyFollows, { c, n -> c.copy(notifyFollows = n) })
        bindToggle(sheet.rowNotifySubs, sheet.switchNotifySubs, { c, n -> c.copy(notifySubs = n) })
        bindToggle(sheet.rowNotifyRaids, sheet.switchNotifyRaids, { c, n -> c.copy(notifyRaids = n) })
        bindToggle(sheet.rowNotifyCheers, sheet.switchNotifyCheers, { c, n -> c.copy(notifyCheers = n) })
        bindToggle(sheet.rowNotifyDonations, sheet.switchNotifyDonations, { c, n -> c.copy(notifyDonations = n) })
        bindToggle(sheet.rowNotifyChatMentions, sheet.switchNotifyChatMentions, { c, n -> c.copy(notifyChatMentions = n) })
        bindToggle(sheet.rowNotifyChannelPoints, sheet.switchNotifyChannelPoints, { c, n -> c.copy(notifyChannelPoints = n) })
        bindToggle(sheet.rowNotifyStreamStatus, sheet.switchNotifyStreamStatus, { c, n -> c.copy(notifyStreamStatus = n) })

        // Haptics & Vibration Strength
        bindToggle(
            sheet.rowSettingHaptics,
            sheet.switchHapticsEnabled,
            { current, next -> current.copy(hapticsEnabled = next) }
        ) { enabled ->
            if (enabled) {
                CompanionNotifier.triggerVibration(
                    this,
                    store.getCompanionSettings(),
                    CompanionNotifier.HapticPattern.SOFT_PULSE
                )
            }
        }
        sheet.rowSettingHapticStrength.setOnClickListener {
            triggerTapHaptic(it)
            showHapticStrengthDialog(sheet) { chosen ->
                val updated = updateCompanionSetting(sheet.rowSettingHapticStrength) { current ->
                    current.copy(hapticStrength = chosen, hapticsEnabled = chosen != "off")
                }
                if (updated.hapticsEnabled && updated.hapticStrength != "off") {
                    CompanionNotifier.triggerVibration(
                        this,
                        updated,
                        CompanionNotifier.HapticPattern.DOUBLE_PULSE
                    )
                }
            }
        }

        // Test Notification & Vibration
        sheet.rowSettingTestAlert.setOnClickListener {
            triggerTapHaptic(it)
            val current = store.getCompanionSettings()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                !CompanionNotifier.hasNotificationPermission(this)
            ) {
                pendingTestAlertAfterPermission = true
                store.markNotificationPrompted()
                requestNotificationPermission(explicit = true)
            } else {
                CompanionNotifier.sendTestNotification(this, current)
                Toast.makeText(this, R.string.toast_test_alert_sent, Toast.LENGTH_SHORT).show()
            }
        }

        // Updates check
        val pendingUpdate = availableUpdate
        if (pendingUpdate != null) {
            sheet.tvSettingUpdatesTitle.text = getString(R.string.menu_update_ready, pendingUpdate.version)
        } else {
            sheet.tvSettingUpdatesTitle.setText(R.string.menu_check_updates)
        }
        sheet.tvSettingUpdatesDesc.text = getString(R.string.setting_updates_desc, currentVersion)
        sheet.rowSettingCheckUpdates.setOnClickListener {
            triggerTapHaptic(it)
            dialog.dismiss()
            val info = availableUpdate
            if (info != null) {
                promptInstallUpdate(info)
            } else {
                Toast.makeText(this, R.string.setting_checking_updates, Toast.LENGTH_SHORT).show()
                checkForUpdates(manual = true)
            }
        }

        // Clear WebView cache
        sheet.rowSettingClearCache.setOnClickListener {
            triggerTapHaptic(it)
            binding.webView.clearCache(true)
            Toast.makeText(this, R.string.toast_cache_cleared, Toast.LENGTH_SHORT).show()
            dialog.dismiss()
        }

        // Forget saved PCs
        val savedConn = store.loadConnection()
        val recentCount = store.getRecentHosts().size
        sheet.tvSettingSavedHostSummary.text = when {
            savedConn != null -> "${savedConn.hostName} (${savedConn.host}:${savedConn.port})"
            recentCount > 0 -> "$recentCount"
            else -> getString(R.string.setting_forget_pcs_none)
        }
        sheet.rowSettingForgetHosts.isEnabled = savedConn != null || recentCount > 0
        sheet.rowSettingForgetHosts.alpha = if (sheet.rowSettingForgetHosts.isEnabled) 1f else 0.5f
        sheet.rowSettingForgetHosts.setOnClickListener {
            triggerTapHaptic(it)
            store.clearAllSavedHosts()
            activeConnection = null
            selectedHost = null
            binding.etManualHost.setText("")
            binding.etPairingCode.setText("")
            binding.etManualPort.setText(store.getDefaultHostPort().toString())
            Toast.makeText(this, R.string.toast_pcs_forgotten, Toast.LENGTH_SHORT).show()
            dialog.dismiss()
            if (screenMode != ScreenMode.CONNECT) {
                disconnectToPairingScreen(clearSaved = true)
            } else {
                triggerLanDiscovery()
            }
        }

        dialog.show()
    }

    private fun applyCompanionSettingsToSheet(
        sheet: BottomSheetSettingsBinding,
        settings: CompanionSettings
    ) {
        suppressSettingsUiEvents = true
        try {
            sheet.switchKeepScreenOn.isChecked = settings.keepScreenOn
            sheet.switchAutoReconnect.isChecked = settings.autoReconnect
            sheet.switchNotificationsEnabled.isChecked = settings.notificationsEnabled
            sheet.switchNotifyFollows.isChecked = settings.notifyFollows
            sheet.switchNotifySubs.isChecked = settings.notifySubs
            sheet.switchNotifyRaids.isChecked = settings.notifyRaids
            sheet.switchNotifyCheers.isChecked = settings.notifyCheers
            sheet.switchNotifyDonations.isChecked = settings.notifyDonations
            sheet.switchNotifyChatMentions.isChecked = settings.notifyChatMentions
            sheet.switchNotifyChannelPoints.isChecked = settings.notifyChannelPoints
            sheet.switchNotifyStreamStatus.isChecked = settings.notifyStreamStatus
            sheet.switchHapticsEnabled.isChecked = settings.hapticsEnabled
            sheet.tvSettingHapticStrengthValue.text = getHapticStrengthLabel(
                if (settings.hapticsEnabled) settings.hapticStrength else "off"
            )

            val notifActive = settings.notificationsEnabled
            sheet.groupNotificationCategories.alpha = if (notifActive) 1f else 0.45f
            listOf(
                sheet.rowNotifyFollows to sheet.switchNotifyFollows,
                sheet.rowNotifySubs to sheet.switchNotifySubs,
                sheet.rowNotifyRaids to sheet.switchNotifyRaids,
                sheet.rowNotifyCheers to sheet.switchNotifyCheers,
                sheet.rowNotifyDonations to sheet.switchNotifyDonations,
                sheet.rowNotifyChatMentions to sheet.switchNotifyChatMentions,
                sheet.rowNotifyChannelPoints to sheet.switchNotifyChannelPoints,
                sheet.rowNotifyStreamStatus to sheet.switchNotifyStreamStatus
            ).forEach { (row, sw) ->
                row.isEnabled = notifActive
                sw.isEnabled = notifActive
            }

            sheet.rowSettingHapticStrength.alpha = if (settings.hapticsEnabled) 1f else 0.55f
            updateSyncBadgeUi(sheet)
        } finally {
            suppressSettingsUiEvents = false
        }
    }

    private fun updateSyncBadgeUi(sheet: BottomSheetSettingsBinding) {
        val hasHost = activeConnection != null || store.loadConnection() != null
        val pending = store.hasPendingCompanionSync()
        when {
            pending -> {
                sheet.tvSheetSyncBadge.setText(R.string.setting_sync_badge_pending)
                sheet.tvSheetSyncBadge.setTextColor(ContextCompat.getColor(this, R.color.accent_violet))
            }
            hasHost -> {
                sheet.tvSheetSyncBadge.setText(R.string.setting_sync_badge_host)
                sheet.tvSheetSyncBadge.setTextColor(ContextCompat.getColor(this, R.color.status_emerald))
            }
            else -> {
                sheet.tvSheetSyncBadge.setText(R.string.setting_sync_badge_local)
                sheet.tvSheetSyncBadge.setTextColor(ContextCompat.getColor(this, R.color.text_muted))
            }
        }
    }

    private fun getHapticStrengthLabel(strength: String): String = when (strength) {
        "off" -> getString(R.string.haptic_strength_off)
        "subtle" -> getString(R.string.haptic_strength_subtle)
        else -> getString(R.string.haptic_strength_strong)
    }

    private fun showHapticStrengthDialog(
        sheet: BottomSheetSettingsBinding,
        onChosen: (String) -> Unit
    ) {
        val values = listOf("off", "subtle", "strong")
        val labels = values.map(::getHapticStrengthLabel).toTypedArray()
        val current = store.getCompanionSettings()
        val effective = if (current.hapticsEnabled) current.hapticStrength else "off"
        val checkedIndex = values.indexOf(effective).coerceAtLeast(0)

        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.setting_haptic_strength_title)
            .setSingleChoiceItems(labels, checkedIndex) { dialog, which ->
                dialog.dismiss()
                onChosen(values[which])
                applyCompanionSettingsToSheet(sheet, store.getCompanionSettings())
            }
            .setNegativeButton(R.string.update_btn_later, null)
            .show()
    }

    private fun triggerTapHaptic(view: View?) {
        CompanionNotifier.triggerUiHaptic(view, store.getCompanionSettings())
    }

    private fun getLanguageOptions(): List<Pair<String, String>> = listOf(
        "" to getString(R.string.setting_language_system),
        "de" to getString(R.string.language_de),
        "en" to getString(R.string.language_en),
        "es" to getString(R.string.language_es),
        "fr" to getString(R.string.language_fr),
        "pt-BR" to getString(R.string.language_pt_br)
    )

    private fun getCurrentLanguageTag(): String {
        val locales = AppCompatDelegate.getApplicationLocales()
        if (locales.isEmpty) return ""
        val first = locales[0] ?: return ""
        val lang = first.language.lowercase()
        val country = first.country.uppercase()
        return when {
            lang == "pt" -> "pt-BR"
            lang == "de" || lang == "en" || lang == "es" || lang == "fr" -> lang
            country.isNotEmpty() -> "$lang-$country"
            else -> ""
        }
    }

    private fun getCurrentLanguageDisplayName(): String {
        val current = getCurrentLanguageTag()
        return getLanguageOptions().firstOrNull { it.first == current }?.second
            ?: getString(R.string.setting_language_system)
    }

    private fun showLanguagePickerDialog() {
        val options = getLanguageOptions()
        val labels = options.map { it.second }.toTypedArray()
        val currentTag = getCurrentLanguageTag()
        val selectedIndex = options.indexOfFirst { it.first == currentTag }.coerceAtLeast(0)

        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.setting_language_pick)
            .setSingleChoiceItems(labels, selectedIndex) { dialog, which ->
                val chosenTag = options[which].first
                dialog.dismiss()
                if (chosenTag != currentTag) {
                    val langSetting = if (chosenTag.isEmpty()) "system" else chosenTag
                    val updated = store.getCompanionSettings().copy(language = langSetting).normalized()
                    val conn = activeConnection ?: store.loadConnection()
                    store.saveCompanionSettings(updated, pendingHostSync = conn != null)
                    if (conn != null) {
                        ioExecutor.execute {
                            if (HostApi.pushCompanionSettings(conn.host, conn.port, conn.token, updated)) {
                                store.setPendingCompanionSync(false)
                            }
                        }
                    }
                    applyLanguageTagIfNeeded(langSetting)
                }
            }
            .setNegativeButton(R.string.update_btn_later, null)
            .show()
    }

    private fun applyLanguageTagIfNeeded(langSetting: String) {
        val desiredTag = if (langSetting == "system") "" else langSetting
        if (desiredTag != getCurrentLanguageTag()) {
            val localeList = if (desiredTag.isEmpty()) {
                LocaleListCompat.getEmptyLocaleList()
            } else {
                LocaleListCompat.forLanguageTags(desiredTag)
            }
            AppCompatDelegate.setApplicationLocales(localeList)
        }
    }

    private fun showDefaultPortDialog() {
        val density = resources.displayMetrics.density
        val padH = (20 * density).toInt()
        val padTop = (8 * density).toInt()
        val container = FrameLayout(this).apply {
            setPadding(padH, padTop, padH, 0)
        }
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER
            hint = getString(R.string.setting_default_port_hint)
            setText(store.getDefaultHostPort().toString())
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_primary))
            setHintTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_muted))
            setSelection(text.length)
        }
        container.addView(input)

        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.setting_default_port_title)
            .setMessage(R.string.setting_default_port_desc)
            .setView(container)
            .setPositiveButton(R.string.setting_port_save) { _, _ ->
                val parsed = input.text.toString().trim().toIntOrNull()
                if (parsed == null || parsed !in 1024..65535) {
                    Toast.makeText(this, R.string.err_invalid_port, Toast.LENGTH_SHORT).show()
                } else {
                    store.setDefaultHostPort(parsed)
                    binding.etManualPort.setText(parsed.toString())
                    Toast.makeText(
                        this,
                        getString(R.string.setting_port_saved, parsed),
                        Toast.LENGTH_SHORT
                    ).show()
                    if (screenMode == ScreenMode.CONNECT) {
                        triggerLanDiscovery()
                    }
                }
            }
            .setNegativeButton(R.string.update_btn_later, null)
            .show()
    }

    private fun checkForUpdates(manual: Boolean) {
        if (isUpdating) return
        val devConn = if (BuildConfig.DEBUG) (activeConnection ?: store.loadConnection()) else null
        if (BuildConfig.DEBUG && devConn == null) {
            if (manual) {
                Toast.makeText(this, R.string.update_check_failed, Toast.LENGTH_SHORT).show()
            }
            return
        }

        ioExecutor.execute {
            val result = if (BuildConfig.DEBUG && devConn != null) {
                AppUpdater.checkForDevUpdate(
                    applicationContext,
                    devConn.host,
                    devConn.port,
                    devConn.token
                )
            } else {
                AppUpdater.checkForUpdate(BuildConfig.VERSION_NAME)
            }
            mainHandler.post {
                if (isDestroyed) return@post
                when (result) {
                    is UpdateCheckResult.UpdateAvailable -> {
                        if (!BuildConfig.DEBUG) AppUpdater.markChecked(this)
                        availableUpdate = result.info
                        binding.tvUpdateBanner.text = if (BuildConfig.DEBUG) {
                            getString(R.string.dev_update_banner_title, result.info.version)
                        } else {
                            getString(R.string.update_banner_title, result.info.version)
                        }
                        binding.updateBanner.visibility = View.VISIBLE
                        if (manual || screenMode == ScreenMode.WEBVIEW) {
                            promptInstallUpdate(result.info)
                        }
                    }
                    UpdateCheckResult.UpToDate -> {
                        if (!BuildConfig.DEBUG) AppUpdater.markChecked(this)
                        if (manual) {
                            val msg = if (BuildConfig.DEBUG) {
                                getString(R.string.dev_update_up_to_date)
                            } else {
                                val current = BuildConfig.VERSION_NAME.substringBefore("-")
                                getString(R.string.update_up_to_date, current)
                            }
                            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                        }
                    }
                    UpdateCheckResult.Failed -> {
                        if (manual) {
                            Toast.makeText(this, R.string.update_check_failed, Toast.LENGTH_SHORT)
                                .show()
                        }
                    }
                }
            }
        }
    }

    private fun promptInstallUpdate(info: AppUpdateInfo) {
        val message = if (BuildConfig.DEBUG) {
            getString(R.string.dev_update_dialog_message, info.version)
        } else {
            val current = BuildConfig.VERSION_NAME.substringBefore("-")
            getString(R.string.update_dialog_message, info.version, current)
        }
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.update_dialog_title)
            .setMessage(message)
            .setPositiveButton(R.string.update_btn_install) { _, _ ->
                downloadAndInstallUpdate(info)
            }
            .setNegativeButton(R.string.update_btn_later, null)
            .show()
    }

    private fun downloadAndInstallUpdate(info: AppUpdateInfo) {
        if (isUpdating) return
        isUpdating = true
        Toast.makeText(this, R.string.update_downloading, Toast.LENGTH_SHORT).show()

        ioExecutor.execute {
            var lastReported = -10
            val result = runCatching {
                AppUpdater.downloadApk(applicationContext, info.downloadUrl, info.authToken) { pct ->
                    if (pct - lastReported >= 25) {
                        lastReported = pct
                        mainHandler.post {
                            if (!isDestroyed) {
                                Toast.makeText(
                                    this,
                                    "${getString(R.string.update_downloading)} ($pct%)",
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        }
                    }
                }
            }
            mainHandler.post {
                if (isDestroyed) return@post
                isUpdating = false
                result.onSuccess { apkFile ->
                    AppUpdater.markDevShaDownloaded(this, info.devSha256)
                    if (AppUpdater.canInstallPackages(this)) {
                        launchApkInstaller(apkFile)
                    } else {
                        pendingInstallApk = apkFile
                        MaterialAlertDialogBuilder(this)
                            .setTitle(R.string.update_dialog_title)
                            .setMessage(R.string.update_install_permission)
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                unknownSourcesLauncher.launch(
                                    AppUpdater.createUnknownSourcesSettingsIntent(this)
                                )
                            }
                            .setNegativeButton(R.string.update_btn_later, null)
                            .show()
                    }
                }.onFailure {
                    Toast.makeText(this, R.string.update_check_failed, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun launchApkInstaller(apkFile: File) {
        startActivity(AppUpdater.createInstallApkIntent(this, apkFile))
    }

    private fun applyKeepScreenOn(enabled: Boolean) {
        if (enabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun showError(msg: String) {
        binding.tvError.text = msg
        binding.tvError.visibility = View.VISIBLE
    }

    private fun clearError() {
        binding.tvError.text = ""
        binding.tvError.visibility = View.GONE
    }
}
