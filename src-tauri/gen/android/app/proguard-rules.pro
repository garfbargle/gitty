# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# MainActivity publishes the window insets to the webview over a
# @JavascriptInterface. R8 renames methods it cannot see called from Kotlin, and
# the only caller is JavaScript, so without this the release build loses the
# insets and the chrome sits under the status bar.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
