package net.flick.bridge;

import org.teavm.jso.JSBody;

/**
 * Isolated Stage 3/4 Java <-> JS ModAPI bridge for TeaVM 0.13.1-eagler Wasm GC.
 * Keeps GuiGraphics strictly inside Java; JS modules return draw commands.
 */
public final class FlickBridge {

    @JSBody(params = {}, script =
        "if (!window.ModAPI) { window.ModAPI = { _mods: new Map(), " +
        "onHudRender: function(id, fn){ this._mods.set(id, { fn: fn, enabled: true }); }, " +
        "setModEnabled: function(id, en){ var m = this._mods.get(id); if (m) m.enabled = !!en; }, " +
        "unregister: function(id){ this._mods.delete(id); } }; }")
    public static native void initRegistry();

    @JSBody(params = { "armorJson" }, script =
        "if (!window.ModAPI || !window.ModAPI._mods) return ''; " +
        "var armor = JSON.parse(armorJson || '[]'); " +
        "var out = []; " +
        "var api = { getPlayerArmor: function(){ return armor; }, " +
        "drawItem: function(item, x, y){ out.push('I|' + item + '|' + (x|0) + '|' + (y|0)); }, " +
        "drawText: function(txt, x, y, col){ var s = String(txt).replace(/\\\\/g,'\\\\\\\\').replace(/\\|/g,'\\\\|').replace(/\\r/g,'\\\\r').replace(/\\n/g,'\\\\n'); out.push('T|' + s + '|' + (x|0) + '|' + (y|0) + '|' + (col||'#ffffff')); } }; " +
        "window.ModAPI._mods.forEach(function(entry, id){ " +
        "  if (!entry.enabled) return; " +
        "  try { entry.fn(api); } catch (e) { console.error('[ModAPI] Error in ' + id + ':', e); } " +
        "}); " +
        "return out.join('\\n');")
    public static native String dispatchHud(String armorJson);
}
