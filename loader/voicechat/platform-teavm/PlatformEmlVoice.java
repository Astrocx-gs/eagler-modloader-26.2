package net.lax1dude.eaglercraft.v1_8.internal;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSObject;
import org.teavm.jso.typedarrays.ArrayBuffer;

import net.lax1dude.eaglercraft.v1_8.internal.teavm.TeaVMUtils;

/**
 * Added by eagler-modloader: the browser side of the built-in voice chat. Everything with audio happens
 * in window.emlVoice (addons/eml-voice.js); without it (a page built without the add-on, or the
 * singleplayer worker, which has no window) voice chat is just unavailable.
 */
public class PlatformEmlVoice {

	@JSBody(script = "return typeof window !== 'undefined' && !!window.emlVoice && window.emlVoice.available();")
	public static native boolean available();

	@JSBody(params = { "talk", "inVoiceWorld" }, script = "return typeof window !== 'undefined' && window.emlVoice ? window.emlVoice.tick(talk, inVoiceWorld) : 0;")
	public static native int tick(boolean talk, boolean inVoiceWorld);

	@JSBody(script = "return typeof window !== 'undefined' && window.emlVoice ? window.emlVoice.poll() : null;")
	private static native ArrayBuffer poll0();

	@JSBody(params = { "o" }, script = "return o == null;")
	private static native boolean isNull(JSObject o);

	public static byte[] poll() {
		ArrayBuffer buf = poll0();
		return isNull(buf) ? null : TeaVMUtils.wrapByteArrayBuffer(buf);
	}

	@JSBody(params = { "id", "frame", "x", "y", "z" }, script = "if (typeof window !== 'undefined' && window.emlVoice) window.emlVoice.play(id, frame, x, y, z);")
	private static native void play0(int id, ArrayBuffer frame, float x, float y, float z);

	public static void play(int id, byte[] frame, float x, float y, float z) {
		play0(id, TeaVMUtils.unwrapArrayBuffer(frame), x, y, z); // a copy (Int8Array.fromJavaArray)
	}

	@JSBody(params = { "name" }, script = "return typeof window !== 'undefined' && window.emlVoice ? window.emlVoice.get(name) : 0;")
	public static native float getSetting(String name);

	@JSBody(params = { "name", "value" }, script = "if (typeof window !== 'undefined' && window.emlVoice) window.emlVoice.set(name, value);")
	public static native void setSetting(String name, float value);

	@JSBody(script = "return typeof window !== 'undefined' && window.emlVoice ? window.emlVoice.level() : 0;")
	public static native float micLevel();

	@JSBody(params = { "testing" }, script = "if (typeof window !== 'undefined' && window.emlVoice) window.emlVoice.test(testing);")
	public static native void setTesting(boolean testing);

	@JSBody(script = "return typeof window !== 'undefined' && window.emlVoice ? window.emlVoice.svcHost() : '';")
	public static native String svcHost();

	@JSBody(params = { "version", "host", "port", "secretHex", "playerHex", "connectionHex", "keepAlive" }, script = "if (typeof window !== 'undefined' && window.emlVoice) window.emlVoice.svcStart(version, host, port, secretHex, playerHex, connectionHex, keepAlive);")
	public static native void svcStart(int version, String host, int port, String secretHex, String playerHex, String connectionHex, int keepAlive);

	@JSBody(script = "if (typeof window !== 'undefined' && window.emlVoice) window.emlVoice.svcStop();")
	public static native void svcStop();

	@JSBody(script = "return typeof window !== 'undefined' && window.emlVoice ? window.emlVoice.svcStatus() : 0;")
	public static native int svcStatus();

	@JSBody(params = { "x", "y", "z", "yaw" }, script = "if (typeof window !== 'undefined' && window.emlVoice) window.emlVoice.svcListener(x, y, z, yaw);")
	public static native void svcListener(double x, double y, double z, float yaw);

	@JSBody(params = { "uuid", "x", "y", "z" }, script = "if (typeof window !== 'undefined' && window.emlVoice) window.emlVoice.svcPlayerPos(uuid, x, y, z);")
	public static native void svcPlayerPos(String uuid, double x, double y, double z);

	@JSBody(script = "return typeof window !== 'undefined' && window.emlVoice ? window.emlVoice.svcSpeakers() : '';")
	public static native String svcSpeakers();
}
