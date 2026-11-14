# Keep custom JS interfaces or WebView helpers if added later
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Preserve ViewBinding classes & Material/AndroidX sheet widgets under R8 release shrinking
-keep class de.tenkayro.streamdash.companion.databinding.** { *; }
-keep class androidx.core.widget.NestedScrollView { *; }
-keep class com.google.android.material.bottomsheet.** { *; }
-keep class com.google.android.material.materialswitch.** { *; }
-keep class com.google.android.material.button.** { *; }
