package nl.endless.kijkdoos;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opent een stream in een externe speler-app (VLC, MX Player, Kodi, ...). */
@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String pkg = call.getString("package", "");
        String title = call.getString("title", "");
        if (url == null || url.isEmpty()) { call.reject("url ontbreekt"); return; }

        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(Uri.parse(url), "video/*");
        i.putExtra("title", title);          // VLC, MX Player, Just Player
        i.putExtra("itemTitle", title);      // sommige spelers
        i.putExtra("secure_uri", true);      // MX Player
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            if (pkg != null && !pkg.isEmpty()) {
                i.setPackage(pkg);
                getActivity().startActivity(i);
            } else {
                getActivity().startActivity(Intent.createChooser(i, "Afspelen met…"));
            }
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Speler niet geïnstalleerd", "NOT_INSTALLED");
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void openStore(PluginCall call) {
        String pkg = call.getString("package", "");
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }
}
