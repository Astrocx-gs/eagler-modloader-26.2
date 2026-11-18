package eaglermodloader.voicechat;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;

import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.lax1dude.eaglercraft.v1_8.internal.PlatformEmlVoice;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.common.ServerboundCustomPayloadPacket;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

/**
 * Talks to servers running Simple Voice Chat (the mod or the plugin), on servers joined through Wispcraft
 * (java:// addresses). The handshake goes over the game connection here; the voice itself goes over UDP
 * in eml-voice.js, through Wispcraft's Wisp proxy.
 *
 * The server only answers a request with its own protocol version, so the versions are tried in turn:
 * 20 (voice chat 2.6.x, most servers), 21 (2.7.x), 18 (2.5.x). Its "incompatible version" replies to
 * the others are hidden.
 */
final class SimpleVoiceChat {
	private static final int[] VERSIONS = { 20, 21, 18 };
	private static final int WAIT = 100; // ticks to wait for an answer before trying the next version

	private static String server; // the java:// address this state belongs to
	private static int ticks, tried, lastAsked;
	private static boolean started, reported;
	private static int version, lastStatus;
	private static boolean sentDisabled, sentMuted, stateSent;
	private static long hideIncompatibleUntil;

	private SimpleVoiceChat() {
	}

	static void init() {
		ClientPlayNetworking.registerGlobalReceiver(SvcPayload.SECRET, (payload, context) -> onSecret(context.client(), payload.data()));
	}

	/** True while connected to a Simple Voice Chat server. */
	static boolean connected() {
		return started && PlatformEmlVoice.svcStatus() == 2;
	}

	/** Hides the server's "incompatible voice chat version" messages while other versions are being tried. */
	static boolean allowMessage(Component message) {
		if (System.currentTimeMillis() > hideIncompatibleUntil) return true;
		String s = message.getString();
		return !(s.contains("voice chat") && (s.contains("not compatible") || s.contains("incompatible")))
			&& !message.toString().contains("message.voicechat.incompatible_version");
	}

	static void reset() {
		if (started) PlatformEmlVoice.svcStop();
		server = null;
		ticks = tried = lastAsked = version = lastStatus = 0;
		started = reported = stateSent = false;
	}

	static void tick(Minecraft mc) {
		ServerData data = mc.getCurrentServer();
		String address = data == null || mc.player == null || mc.getConnection() == null || mc.isLocalServer() ? null : data.ip;
		if (address == null || !address.toLowerCase(Locale.ROOT).startsWith("java://")) {
			if (server != null) reset();
			return;
		}
		if (!address.equals(server)) {
			reset();
			server = address;
		}
		ticks++;
		if (!started) {
			// ask for the secret once the server has said which channels it has (or after a while anyway)
			boolean ready = ticks > 200 || ticks > 20 && ClientPlayNetworking.canSend(SvcPayload.REQUEST_SECRET);
			if (ready && tried < VERSIONS.length && ticks >= lastAsked + WAIT) {
				int v = VERSIONS[tried++];
				lastAsked = ticks;
				version = v;
				hideIncompatibleUntil = System.currentTimeMillis() + 15000L;
				send(mc, SvcPayload.REQUEST_SECRET, ByteBuffer.allocate(4).putInt(v).array());
			}
			return;
		}

		int status = PlatformEmlVoice.svcStatus();
		if (status != lastStatus) {
			if (status == 2) sendState(mc, true);
			if (status >= 3 && !reported) {
				reported = true;
				mc.gui.hud.getChat().addClientSystemMessage(Component.translatable(status == 3 ? "emlvoice.svc.cant" : status == 4 ? "emlvoice.svc.noanswer" : "emlvoice.svc.lost"));
			}
			lastStatus = status;
		}
		if (status == 2) {
			sendState(mc, false);
			// where the camera is and where the talking players are, for the 3D sound
			Camera camera = mc.gameRenderer.mainCamera();
			Vec3 at = camera.position();
			PlatformEmlVoice.svcListener(at.x, at.y, at.z, camera.yRot());
			for (String id : speakers()) {
				Player p = mc.level == null ? null : mc.level.getPlayerByUUID(UUID.fromString(id));
				if (p != null) PlatformEmlVoice.svcPlayerPos(id, p.getX(), p.getEyeY(), p.getZ());
			}
		}
	}

	/** The players being heard right now (UUIDs). */
	static String[] speakers() {
		String s = PlatformEmlVoice.svcSpeakers();
		return s == null || s.isEmpty() ? new String[0] : s.split(",");
	}

	static String name(Minecraft mc, String id) {
		try {
			PlayerInfo info = mc.getConnection() == null ? null : mc.getConnection().getPlayerInfo(UUID.fromString(id));
			if (info != null) return info.getProfile().name();
		} catch (IllegalArgumentException e) {
			// not a UUID
		}
		return Component.translatable("emlvoice.hud.someone").getString();
	}

	private static void send(Minecraft mc, net.minecraft.network.protocol.common.custom.CustomPacketPayload.Type<SvcPayload> type, byte[] data) {
		if (mc.getConnection() != null) mc.getConnection().send(new ServerboundCustomPayloadPacket(new SvcPayload(type, data)));
	}

	/** Tells the server whether voice chat is off (and muted, for version 21), when it changes. */
	private static void sendState(Minecraft mc, boolean force) {
		boolean disabled = PlatformEmlVoice.getSetting("enabled") < 0.5F;
		boolean muted = PlatformEmlVoice.getSetting("muted") >= 0.5F;
		if (!force && stateSent && disabled == sentDisabled && muted == sentMuted) return;
		stateSent = true;
		sentDisabled = disabled;
		sentMuted = muted;
		if (version >= 21) send(mc, SvcPayload.CLIENT_STATE, new byte[] { (byte) (muted ? 1 : 0), (byte) (disabled ? 1 : 0) });
		else send(mc, SvcPayload.UPDATE_STATE, new byte[] { (byte) (disabled ? 1 : 0) });
	}

	private static void onSecret(Minecraft mc, byte[] data) {
		if (server == null || started) return;
		Secret s = Secret.read(data, true);
		int v;
		if (s != null) {
			v = 21;
		} else {
			s = Secret.read(data, false);
			if (s == null) return;
			v = version == 18 ? 18 : 20;
		}
		version = v;
		started = true;
		lastStatus = 0;
		hideIncompatibleUntil = System.currentTimeMillis() + 3000L;

		// where the voice server is: the server's own address, unless it says otherwise (voice_host)
		String host = serverHost();
		int port = s.port;
		String voiceHost = s.voiceHost.trim();
		if (!voiceHost.isEmpty()) {
			try {
				int p = Integer.parseInt(voiceHost);
				if (p > 0 && p <= 65535) port = p;
			} catch (NumberFormatException e) {
				String h = voiceHost;
				int colon = h.lastIndexOf(':');
				if (colon > 0 && h.indexOf(':') == colon) {
					try {
						port = Integer.parseInt(h.substring(colon + 1));
					} catch (NumberFormatException ignored) {
						// keep the port
					}
					h = h.substring(0, colon);
				}
				if (!h.isEmpty()) host = h;
			}
		}
		PlatformEmlVoice.svcStart(v, host, port, hex(s.secret), hex(s.player), s.connection == null ? "" : hex(s.connection), s.keepAlive);
	}

	/** The host the game connection went to: from Wispcraft (after its SRV lookup), or else the address typed in. */
	private static String serverHost() {
		String typed = server.substring("java://".length());
		int slash = typed.indexOf('/');
		if (slash >= 0) typed = typed.substring(0, slash);
		int colon = typed.lastIndexOf(':');
		if (colon > 0 && typed.indexOf(':') == colon) typed = typed.substring(0, colon);
		String w = PlatformEmlVoice.svcHost();
		if (w != null) {
			int bar = w.indexOf('|');
			if (bar > 0 && w.substring(0, bar).equalsIgnoreCase(typed) && bar + 1 < w.length()) return w.substring(bar + 1);
		}
		return typed;
	}

	private static String hex(byte[] b) {
		StringBuilder sb = new StringBuilder(b.length * 2);
		for (byte x : b) sb.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
		return sb.toString();
	}

	/** What the server's secret packet says (only the parts used here). */
	private static final class Secret {
		byte[] secret, connection, player;
		int port, keepAlive;
		String voiceHost;

		/** Reads it with or without the connection id (version 21 has one); null if it doesn't fit exactly. */
		static Secret read(byte[] data, boolean withConnection) {
			try {
				ByteBuffer b = ByteBuffer.wrap(data);
				Secret s = new Secret();
				s.secret = bytes(b, 16);
				if (withConnection) s.connection = bytes(b, 16);
				s.port = b.getInt();
				s.player = bytes(b, 16);
				byte codec = b.get();
				int mtu = b.getInt();
				double distance = b.getDouble();
				s.keepAlive = b.getInt();
				b.get(); // groups enabled
				int n = varint(b);
				if (n < 0 || n > b.remaining()) return null;
				s.voiceHost = new String(bytes(b, n), StandardCharsets.UTF_8);
				b.get(); // recording allowed
				if (b.hasRemaining() || codec < 0 || codec > 2 || mtu <= 0 || !(distance > 0) || s.port <= 0 || s.port > 65535) return null;
				return s;
			} catch (RuntimeException e) {
				return null;
			}
		}

		private static byte[] bytes(ByteBuffer b, int n) {
			byte[] out = new byte[n];
			b.get(out);
			return out;
		}

		private static int varint(ByteBuffer b) {
			int v = 0, shift = 0;
			byte x;
			do {
				x = b.get();
				v |= (x & 127) << shift;
				shift += 7;
			} while ((x & 128) != 0 && shift < 35);
			return v;
		}
	}
}
