package eaglermodloader.voicechat;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.server.level.ServerPlayer;

/**
 * Proximity voice chat made for the browser. The server side: passes what a player says on to the
 * players within {@link #RANGE} blocks of them in the same dimension who have voice chat too.
 * In a world shared to LAN the host's game is the server, so everyone there can talk.
 */
public final class VoiceChat implements ModInitializer {
	public static final String MOD_ID = "emlvoice";
	/** How far a voice carries, in blocks (it fades out on the way). */
	public static final double RANGE = 48.0;
	/** Largest frame accepted (a frame is 323 bytes). */
	public static final int MAX_FRAME = 1024;

	@Override
	public void onInitialize() {
		PayloadTypeRegistry.serverboundPlay().register(MicPayload.TYPE, MicPayload.CODEC);
		PayloadTypeRegistry.clientboundPlay().register(SpeakerPayload.TYPE, SpeakerPayload.CODEC);
		ServerPlayNetworking.registerGlobalReceiver(MicPayload.TYPE, VoiceChat::relay);
	}

	private static void relay(MicPayload payload, ServerPlayNetworking.Context context) {
		ServerPlayer from = context.player();
		SpeakerPayload out = null;
		for (ServerPlayer to : from.level().players()) {
			if (to == from || to.distanceToSqr(from) > RANGE * RANGE || !ServerPlayNetworking.canSend(to, SpeakerPayload.TYPE)) continue;
			if (out == null) out = new SpeakerPayload(from.getId(), payload.frame());
			ServerPlayNetworking.send(to, out);
		}
	}
}
