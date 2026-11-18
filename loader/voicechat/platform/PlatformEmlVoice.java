package net.lax1dude.eaglercraft.v1_8.internal;

/**
 * Added by eagler-modloader: the built-in voice chat's way to the browser (microphone and speakers).
 * Like Eaglercraft's other Platform* classes, the game compiles against this and the browser uses
 * platform-teavm's copy, which calls window.emlVoice (addons/eml-voice.js).
 */
public class PlatformEmlVoice {

	public static native boolean available();

	/** Called every client tick; returns 0 not in a voice world, 1 idle, 2 talking, 3 no microphone, 4 voice chat off, 5 muted. */
	public static native int tick(boolean talk, boolean inVoiceWorld);

	/** The next recorded frame to send, or null. */
	public static native byte[] poll();

	/** Plays a frame from player id at (x, y, z) blocks from the listener (x right, y up, -z ahead). */
	public static native void play(int id, byte[] frame, float x, float y, float z);

	public static native float getSetting(String name);

	public static native void setSetting(String name, float value);

	/** Microphone loudness, 0 to 1. */
	public static native float micLevel();

	public static native void setTesting(boolean testing);

	// Simple Voice Chat (servers with it, joined through Wispcraft); the voice goes over UDP in eml-voice.js

	/** The server Wispcraft connected to last, "typed name|host", or "". */
	public static native String svcHost();

	public static native void svcStart(int version, String host, int port, String secretHex, String playerHex, String connectionHex, int keepAlive);

	public static native void svcStop();

	/** 0 none, 1 connecting, 2 connected, 3 can't connect from this browser, 4 no answer, 5 connection lost. */
	public static native int svcStatus();

	/** The camera's world position and yaw. */
	public static native void svcListener(double x, double y, double z, float yaw);

	/** A talking player's head, in world coordinates. */
	public static native void svcPlayerPos(String uuid, double x, double y, double z);

	/** The players heard in the last moment, comma separated UUIDs. */
	public static native String svcSpeakers();
}
