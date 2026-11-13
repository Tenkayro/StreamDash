package dev.streamdash.companion

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
import android.widget.PopupMenu
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import dev.streamdash.companion.databinding.ActivityMainBinding
import java.io.File
import java.util.concurrent.Executors

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
    private var isScanning = false
    private var isConnecting = false
    private var reconnectScheduled = false
    private var isDestroyed = false
    private var availableUpdate: AppUpdateInfo? = null
    private var pendingInstallApk: File? = null
    private var isUpdating = false

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
        }
    }

    private val qrScannerLauncher = registerForActivityResult(ScanContract()) { result ->
        val raw = result.contents ?: return@registerForActivityResult
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
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        store = ConnectionStore(this)
        applyKeepScreenOn(store.isKeepScreenOn())
        setupInsets()
        setupWebView()
        setupListeners()
        setupBackNavigation()

        val saved = store.loadConnection()
        if (saved != null) {
            activeConnection = saved
            binding.etManualHost.setText(saved.host)
            binding.etManualPort.setText(saved.port.toString())
            binding.etPairingCode.setText(saved.token)
            showReconnectScreen(saved)
            attemptSavedConnection(isRetry = false)
        } else {
            switchScreen(ScreenMode.CONNECT)
            triggerLanDiscovery()
        }

        if (AppUpdater.shouldAutoCheck(this)) {
            checkForUpdates(manual = false)
        }
    }

    override fun onDestroy() {
        isDestroyed = true
        cancelReconnectLoop()
        binding.webView.destroy()
        ioExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun setupInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(binding.rootContainer) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
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
        binding.btnScanQr.setOnClickListener {
            clearError()
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED
            ) {
                startQrScanner()
            } else {
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            }
        }

        binding.btnRefreshLan.setOnClickListener {
            triggerLanDiscovery()
        }

        binding.btnToggleManual.setOnClickListener {
            setManualExpanded(!manualExpanded)
        }

        binding.btnConnect.setOnClickListener {
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
            cancelReconnectLoop()
            attemptSavedConnection(isRetry = true)
        }

        binding.btnSwitchPc.setOnClickListener {
            disconnectToPairingScreen(clearSaved = false)
        }

        binding.btnQuickMenu.setOnClickListener { anchor ->
            showCompanionMenu(anchor)
        }

        binding.btnInstallUpdate.setOnClickListener {
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

        binding.webView.setBackgroundColor(Color.parseColor("#0B0C0F"))
        binding.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        binding.webView.webChromeClient = WebChromeClient()
        binding.webView.webViewClient = object : WebViewClient() {
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
        val options = ScanOptions().apply {
            setCaptureActivity(PortraitCaptureActivity::class.java)
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt(getString(R.string.qr_scanner_prompt))
            setBeepEnabled(false)
            setOrientationLocked(true)
        }
        qrScannerLauncher.launch(options)
    }

    private fun setManualExpanded(expanded: Boolean) {
        manualExpanded = expanded
        binding.manualHostSection.visibility = if (expanded) View.VISIBLE else View.GONE
        binding.btnToggleManual.setText(
            if (expanded) R.string.toggle_manual_hide else R.string.toggle_manual_show
        )
    }

    private fun triggerLanDiscovery() {
        if (isScanning) return
        isScanning = true
        binding.rowScanning.visibility = View.VISIBLE
        binding.tvNoPcsFound.visibility = View.GONE

        ioExecutor.execute {
            val results = LanDiscovery.discover(applicationContext, timeoutMs = 1500)
            mainHandler.post {
                if (isDestroyed) return@post
                isScanning = false
                binding.rowScanning.visibility = View.GONE
                discoveredHosts = results
                if (results.size == 1 && selectedHost == null) {
                    selectedHost = results.first()
                } else if (selectedHost != null) {
                    selectedHost = results.find {
                        it.ip == selectedHost?.ip && it.port == selectedHost?.port
                    }
                }
                renderDiscoveredHosts()
            }
        }
    }

    private fun renderDiscoveredHosts() {
        val container = binding.discoveredListContainer
        container.removeAllViews()

        if (discoveredHosts.isEmpty()) {
            binding.tvNoPcsFound.visibility = View.VISIBLE
            return
        }
        binding.tvNoPcsFound.visibility = View.GONE

        val inflater = LayoutInflater.from(this)
        for (host in discoveredHosts) {
            val itemView = inflater.inflate(R.layout.item_discovered_host, container, false)
            val tvName = itemView.findViewById<TextView>(R.id.tvHostName)
            val tvEndpoint = itemView.findViewById<TextView>(R.id.tvHostEndpoint)
            val tvBadge = itemView.findViewById<TextView>(R.id.tvHostAuthBadge)

            tvName.text = host.hostName
            tvEndpoint.text = "${host.ip}:${host.port}"
            tvBadge.setText(if (host.authRequired) R.string.badge_code_required else R.string.badge_no_code)
            tvBadge.setTextColor(
                ContextCompat.getColor(
                    this,
                    if (host.authRequired) R.color.accent_violet else R.color.status_emerald
                )
            )

            val isSelected = selectedHost?.ip == host.ip && selectedHost?.port == host.port
            itemView.setBackgroundResource(
                if (isSelected) R.drawable.bg_card_selected else R.drawable.bg_card
            )

            itemView.setOnClickListener {
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
            val port = manualPortStr.ifEmpty { HostApi.DEFAULT_PORT.toString() }.toIntOrNull()
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
                // Quick discovery before asking for manual IP
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
        cancelReconnectLoop()
        switchScreen(ScreenMode.WEBVIEW)
        applyKeepScreenOn(store.isKeepScreenOn())
        val url = HostApi.buildDashboardUrl(conn.host, conn.port, conn.token)
        binding.webView.loadUrl(url)
    }

    private fun showReconnectScreen(conn: SavedConnection) {
        switchScreen(ScreenMode.RECONNECT)
        binding.tvReconnectTitle.text = getString(R.string.reconnect_title, conn.hostName)
        binding.tvReconnectSubtitle.text = getString(R.string.reconnect_subtitle, conn.host, conn.port)
    }

    private fun disconnectToPairingScreen(clearSaved: Boolean, initialError: String? = null) {
        cancelReconnectLoop()
        if (clearSaved) {
            store.clearConnection()
            activeConnection = null
        }
        binding.webView.stopLoading()
        binding.webView.loadUrl("about:blank")
        applyKeepScreenOn(false)
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

    private fun showCompanionMenu(anchor: View) {
        val popup = PopupMenu(this, anchor)
        val awake = store.isKeepScreenOn()
        popup.menu.add(0, 1, 0, if (awake) R.string.menu_keep_screen_off else R.string.menu_keep_screen_on)
        popup.menu.add(0, 2, 1, R.string.menu_reload)
        val pendingUpdate = availableUpdate
        val updateLabel = if (pendingUpdate != null) {
            getString(R.string.menu_update_ready, pendingUpdate.version)
        } else {
            getString(R.string.menu_check_updates)
        }
        popup.menu.add(0, 4, 2, updateLabel)
        popup.menu.add(0, 3, 3, R.string.menu_disconnect)

        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> {
                    val next = !store.isKeepScreenOn()
                    store.setKeepScreenOn(next)
                    applyKeepScreenOn(next)
                    Toast.makeText(
                        this,
                        if (next) R.string.toast_screen_awake_on else R.string.toast_screen_awake_off,
                        Toast.LENGTH_SHORT
                    ).show()
                    true
                }
                2 -> {
                    binding.webView.reload()
                    true
                }
                4 -> {
                    val info = availableUpdate
                    if (info != null) {
                        promptInstallUpdate(info)
                    } else {
                        checkForUpdates(manual = true)
                    }
                    true
                }
                3 -> {
                    disconnectToPairingScreen(clearSaved = true)
                    true
                }
                else -> false
            }
        }
        popup.show()
    }

    private fun checkForUpdates(manual: Boolean) {
        if (isUpdating) return
        ioExecutor.execute {
            val result = AppUpdater.checkForUpdate(BuildConfig.VERSION_NAME)
            mainHandler.post {
                if (isDestroyed) return@post
                when (result) {
                    is UpdateCheckResult.UpdateAvailable -> {
                        AppUpdater.markChecked(this)
                        availableUpdate = result.info
                        binding.tvUpdateBanner.text =
                            getString(R.string.update_banner_title, result.info.version)
                        binding.updateBanner.visibility = View.VISIBLE
                        if (manual || screenMode == ScreenMode.WEBVIEW) {
                            promptInstallUpdate(result.info)
                        }
                    }
                    UpdateCheckResult.UpToDate -> {
                        AppUpdater.markChecked(this)
                        if (manual) {
                            val current = BuildConfig.VERSION_NAME.substringBefore("-")
                            Toast.makeText(
                                this,
                                getString(R.string.update_up_to_date, current),
                                Toast.LENGTH_SHORT
                            ).show()
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
        val current = BuildConfig.VERSION_NAME.substringBefore("-")
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.update_dialog_title)
            .setMessage(getString(R.string.update_dialog_message, info.version, current))
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
                AppUpdater.downloadApk(applicationContext, info.downloadUrl) { pct ->
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
        if (enabled && screenMode == ScreenMode.WEBVIEW) {
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
