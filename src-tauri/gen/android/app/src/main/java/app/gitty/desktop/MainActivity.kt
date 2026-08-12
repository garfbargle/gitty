package app.gitty.desktop

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/// Android 15 made edge-to-edge the default and Android 16 removed the opt-out,
/// so the webview always draws under the status bar and the gesture handle. The
/// layout has to be told where those are, and CSS `env(safe-area-inset-*)` is
/// not a dependable source for it: Android WebView reports 0 on many versions
/// and was off by a few pixels at the top until WebView 140. The insets are read
/// natively here instead and published as CSS custom properties.
///
/// Two paths deliver them, because neither alone covers the whole lifetime:
///
///   - `insets()` on the JS bridge is a pull, for the cold start. wry calls
///     `setContentView` and then `loadUrl`, so the first inset pass lands while
///     the webview is still on about:blank and any push made then is discarded.
///     Without a pull the properties would stay at 0 until something happened to
///     change the insets -- which on a phone that never rotates is never.
///   - the listener is a push, for everything after: folding and unfolding,
///     rotation, docking to DeX, and the soft keyboard opening.
class MainActivity : TauriActivity() {
  /// Last insets seen, as the JSON the bridge hands to the frontend. Written on
  /// the main thread by the inset listener and read on a WebView JS thread by
  /// the bridge, hence @Volatile.
  @Volatile
  private var insetsJson: String = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  @SuppressLint("JavascriptInterface")
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(InsetBridge(), BRIDGE_NAME)

    // The listener hands back a plain View; the WebView is captured instead, so
    // the script below goes to the thing that can run it.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, windowInsets ->
      // The bars and the cutout together: a Fold in landscape puts the cutout
      // on a side where there is no bar, and taking only one of the two leaves
      // content under the other.
      val bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())

      // CSS pixels, not physical ones. A CSS pixel is a dp in Android WebView,
      // so density is the whole conversion.
      val density = webView.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
      val top = bars.top / density
      val right = bars.right / density
      val left = bars.left / density
      // The keyboard replaces the navigation bar rather than stacking with it,
      // so the larger of the two is the real clearance. Folding it in here is
      // what keeps the commit box above the keyboard: the window itself does
      // not resize once the app is edge-to-edge, so nothing else would.
      val bottom = maxOf(bars.bottom, ime.bottom) / density

      insetsJson = "{\"top\":$top,\"right\":$right,\"bottom\":$bottom,\"left\":$left}"
      webView.evaluateJavascript(applyScript(top, right, bottom, left), null)

      // Returned unconsumed: this listener only observes.
      windowInsets
    }
  }

  private inner class InsetBridge {
    @JavascriptInterface
    fun insets(): String = insetsJson
  }

  private companion object {
    const val BRIDGE_NAME = "__gittyAndroidInsets"

    /// Sets the properties directly rather than going through the frontend, so
    /// the chrome is positioned correctly even on a push that arrives before
    /// React has mounted. The event is for anything that needs to measure.
    fun applyScript(top: Float, right: Float, bottom: Float, left: Float): String =
      """
      (function () {
        var root = document.documentElement;
        if (!root) return;
        root.style.setProperty('--android-inset-top', '${top}px');
        root.style.setProperty('--android-inset-right', '${right}px');
        root.style.setProperty('--android-inset-bottom', '${bottom}px');
        root.style.setProperty('--android-inset-left', '${left}px');
        window.dispatchEvent(new Event('android-insets-changed'));
      })();
      """.trimIndent()
  }
}
