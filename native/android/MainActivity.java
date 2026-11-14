package nl.endless.kijkdoos;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ExternalPlayerPlugin.class);
        super.onCreate(savedInstanceState);

        // De app begint ónder de statusbalk/notch en eindigt boven de navigatiebalk,
        // zodat het menu (⚙) in staande stand gewoon bereikbaar is.
        getWindow().setStatusBarColor(Color.parseColor("#0B0D14"));
        getWindow().setNavigationBarColor(Color.parseColor("#0B0D14"));
        View root = findViewById(android.R.id.content);
        WindowInsetsControllerCompat ctl = WindowCompat.getInsetsController(getWindow(), root);
        ctl.setAppearanceLightStatusBars(false);
        ctl.setAppearanceLightNavigationBars(false);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            v.setBackgroundColor(Color.parseColor("#0B0D14"));
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
