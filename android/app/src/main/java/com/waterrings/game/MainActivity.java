package com.waterrings.game;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Последние размеры выреза под камеру в CSS-пикселях: l, t, r, b
    private String safeInsetsJs = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Во время игры экран не гаснет
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Рисуем и в зоне выреза под камеру — иначе вдоль неё остаётся чёрная полоса.
        // Что именно обходить, игра решает сама по размерам выреза (window.__safeInsets)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, insets) -> {
            Insets c = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            float d = getResources().getDisplayMetrics().density;
            safeInsetsJs = "window.__safeInsets={l:" + c.left / d + ",t:" + c.top / d + ",r:" + c.right / d + ",b:" + c.bottom / d + "};"
                + "window.dispatchEvent(new Event('resize'));";
            sendSafeInsets();
            return ViewCompat.onApplyWindowInsets(v, insets);
        });
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // После шторки уведомлений или переключения приложений снова прячем панели;
        // заодно повторяем размеры выреза — страница могла загрузиться позже первой отправки
        if (hasFocus) {
            hideSystemBars();
            sendSafeInsets();
        }
    }

    private void sendSafeInsets() {
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web == null || safeInsetsJs == null) return;
        final String js = safeInsetsJs;
        web.post(() -> web.evaluateJavascript(js, null));
    }

    // Полный экран: строка состояния и навигация скрыты, появляются свайпом от края и прячутся сами
    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
