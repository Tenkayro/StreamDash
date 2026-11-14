package de.tenkayro.streamdash.companion

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.util.Size
import android.view.MotionEvent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import de.tenkayro.streamdash.companion.databinding.ActivityScannerBinding
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class PortraitCaptureActivity : AppCompatActivity() {

    private lateinit var binding: ActivityScannerBinding
    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private val foundResult = AtomicBoolean(false)
    private var activeCamera: Camera? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var yuvBuffer = ByteArray(0)

    private val qrReader = QRCodeReader()
    private val decodeHints: Map<DecodeHintType, Any> = mapOf(
        DecodeHintType.TRY_HARDER to true,
        DecodeHintType.ALSO_INVERTED to true
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )
        super.onCreate(savedInstanceState)
        binding = ActivityScannerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.scannerRoot) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.updatePadding(
                left = bars.left,
                top = bars.top,
                right = bars.right,
                bottom = bars.bottom
            )
            insets
        }

        binding.btnCloseScanner.setOnClickListener {
            setResult(RESULT_CANCELED)
            finish()
        }

        setupTapToFocus()
        startCamera()
    }

    override fun onDestroy() {
        runCatching { cameraProvider?.unbindAll() }
        cameraProvider = null
        activeCamera = null
        analysisExecutor.shutdownNow()
        super.onDestroy()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupTapToFocus() {
        binding.previewView.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_UP) {
                val camera = activeCamera ?: return@setOnTouchListener false
                val point = binding.previewView.meteringPointFactory.createPoint(event.x, event.y)
                val action = FocusMeteringAction.Builder(
                    point,
                    FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE
                )
                    .setAutoCancelDuration(3, TimeUnit.SECONDS)
                    .build()
                camera.cameraControl.startFocusAndMetering(action)
            }
            true
        }
    }

    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = runCatching { providerFuture.get() }.getOrNull() ?: return@addListener
            if (isFinishing || isDestroyed) return@addListener
            cameraProvider = provider

            val preview = Preview.Builder()
                .build()
                .also { it.surfaceProvider = binding.previewView.surfaceProvider }

            val resolutionSelector = ResolutionSelector.Builder()
                .setResolutionStrategy(
                    ResolutionStrategy(
                        Size(1280, 720),
                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                    )
                )
                .build()

            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(resolutionSelector)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            analysis.setAnalyzer(analysisExecutor) { imageProxy ->
                analyzeFrame(imageProxy)
            }

            runCatching {
                provider.unbindAll()
                // CameraX enables continuous picture autofocus (CONTROL_AF_MODE_CONTINUOUS_PICTURE) by default
                activeCamera = provider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis
                )
                triggerCenterFocus()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun triggerCenterFocus() {
        val camera = activeCamera ?: return
        binding.previewView.post {
            val w = binding.previewView.width.toFloat()
            val h = binding.previewView.height.toFloat()
            if (w <= 0f || h <= 0f) return@post
            val point = binding.previewView.meteringPointFactory.createPoint(w / 2f, h / 2f)
            val action = FocusMeteringAction.Builder(
                point,
                FocusMeteringAction.FLAG_AF
            )
                .setAutoCancelDuration(2, TimeUnit.SECONDS)
                .build()
            camera.cameraControl.startFocusAndMetering(action)
        }
    }

    private fun analyzeFrame(imageProxy: ImageProxy) {
        try {
            if (foundResult.get()) return
            val yPlane = imageProxy.planes.firstOrNull() ?: return
            val buffer = yPlane.buffer
            val rowStride = yPlane.rowStride
            val width = imageProxy.width
            val height = imageProxy.height
            val remaining = buffer.remaining()
            if (yuvBuffer.size != remaining) {
                yuvBuffer = ByteArray(remaining)
            }
            buffer.get(yuvBuffer)

            val source = PlanarYUVLuminanceSource(
                yuvBuffer,
                rowStride,
                height,
                0,
                0,
                width,
                height,
                false
            )
            val bitmap = BinaryBitmap(HybridBinarizer(source))
            val decoded = runCatching { qrReader.decode(bitmap, decodeHints) }.getOrNull()
            qrReader.reset()

            val text = decoded?.text?.trim().orEmpty()
            if (text.isNotEmpty() && foundResult.compareAndSet(false, true)) {
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    setResult(RESULT_OK, Intent().putExtra(EXTRA_QR_RESULT, text))
                    finish()
                }
            }
        } finally {
            imageProxy.close()
        }
    }

    companion object {
        const val EXTRA_QR_RESULT = "qr_result"
    }
}
