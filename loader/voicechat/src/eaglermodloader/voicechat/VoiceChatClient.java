package eaglermodloader.voicechat;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

import com.mojang.blaze3d.platform.InputConstants;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.lax1dude.eaglercraft.v1_8.internal.PlatformEmlVoice;
import net.minecraft.client.Camera;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;

/**
 * The client side: push-to-talk or voice activation, sending the microphone's frames, playing other
 * players' voices from where they stand, and a small display of who is talking.
 */
public final class VoiceChatClient implements ClientModInitializer {
	public static final int IDLE = 1, TALKING = 2, NO_MIC = 3, OFF = 4, MUTED = 5;

	static KeyMapping talkKey, muteKey, offKey, settingsKey;
	/** Entity id -> when their voice was last heard (ms). */
	private static final Map<Integer, Long> talking = new LinkedHashMap<>();
	private static int status;
	private static boolean talkWasDown;

	@Override
	public void onInitializeClient() {
		KeyMapping.Category category = KeyMapping.Category.register(Identifier.fromNamespaceAndPath(VoiceChat.MOD_ID, "voicechat"));
		talkKey = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.emlvoice.talk", InputConstants.Type.KEYSYM, InputConstants.KEY_V, category));
		muteKey = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.emlvoice.mute", InputConstants.Type.KEYSYM, InputConstants.KEY_M, category));
		offKey = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.emlvoice.off", InputConstants.Type.KEYSYM, InputConstants.KEY_N, category));
		settingsKey = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.emlvoice.settings", InputConstants.Type.KEYSYM, InputConstants.KEY_B, category));
		ClientPlayNetworking.registerGlobalReceiver(SpeakerPayload.TYPE, VoiceChatClient::onSpeaker);
		ClientTickEvents.END_CLIENT_TICK.register(VoiceChatClient::tick);
		HudElementRegistry.addLast(Identifier.fromNamespaceAndPath(VoiceChat.MOD_ID, "status"), VoiceChatClient::hud);
	}

	static boolean voiceMode() {
		return PlatformEmlVoice.getSetting("mode") >= 0.5F;
	}

	static void toggle(String setting) {
		PlatformEmlVoice.setSetting(setting, PlatformEmlVoice.getSetting(setting) >= 0.5F ? 0.0F : 1.0F);
	}

	private static boolean inVoiceWorld(Minecraft mc) {
		if (mc.level == null || mc.player == null || mc.getConnection() == null) return false;
		try {
			return ClientPlayNetworking.canSend(MicPayload.TYPE);
		} catch (RuntimeException e) {
			return false;
		}
	}

	private static void tick(Minecraft mc) {
		boolean inWorld = inVoiceWorld(mc);
		boolean talkDown = talkKey.isDown() && mc.gui.screen() == null;

		while (muteKey.consumeClick()) {
			toggle("muted");
			overlay(mc, PlatformEmlVoice.getSetting("muted") >= 0.5F ? "emlvoice.muted" : "emlvoice.unmuted");
		}
		while (offKey.consumeClick()) {
			toggle("enabled");
			overlay(mc, PlatformEmlVoice.getSetting("enabled") >= 0.5F ? "emlvoice.on" : "emlvoice.off");
		}
		while (settingsKey.consumeClick()) {
			mc.gui.setScreen(new VoiceSettingsScreen(mc.gui.screen()));
		}
		if (talkDown && !talkWasDown && !inWorld && mc.level != null && !voiceMode()) {
			overlay(mc, PlatformEmlVoice.available() ? "emlvoice.unavailable" : "emlvoice.unsupported");
		}
		talkWasDown = talkDown;

		status = PlatformEmlVoice.tick(talkDown, inWorld);
		if (inWorld) {
			byte[] frame;
			for (int n = 0; n < 10 && (frame = PlatformEmlVoice.poll()) != null; n++) {
				ClientPlayNetworking.send(new MicPayload(frame));
			}
		}
		long old = System.currentTimeMillis() - 400L;
		for (Iterator<Long> it = talking.values().iterator(); it.hasNext();) {
			if (it.next() < old) it.remove();
		}
	}

	private static void overlay(Minecraft mc, String key) {
		if (mc.player != null) mc.player.sendOverlayMessage(Component.translatable(key));
	}

	private static void onSpeaker(SpeakerPayload payload, ClientPlayNetworking.Context context) {
		Minecraft mc = context.client();
		talking.put(payload.entityId(), System.currentTimeMillis());
		Entity speaker = mc.level == null ? null : mc.level.getEntity(payload.entityId());
		if (speaker == null) {
			PlatformEmlVoice.play(payload.entityId(), payload.frame(), 0.0F, 0.0F, -1.0F);
			return;
		}
		// where the speaker is, turned to the camera: x to the right, y up, -z straight ahead
		Camera camera = mc.gameRenderer.mainCamera();
		Vec3 at = camera.position();
		double dx = speaker.getX() - at.x, dy = speaker.getEyeY() - at.y, dz = speaker.getZ() - at.z;
		double yaw = Math.toRadians(camera.yRot());
		double forward = -Math.sin(yaw) * dx + Math.cos(yaw) * dz;
		double right = -Math.cos(yaw) * dx - Math.sin(yaw) * dz;
		PlatformEmlVoice.play(payload.entityId(), payload.frame(), (float) right, (float) dy, (float) -forward);
	}

	private static void hud(GuiGraphicsExtractor graphics, DeltaTracker delta) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null) return;
		int x = 4, y = graphics.guiHeight() / 2 - 30;
		String line = null;
		int color = 0xFFAAAAAA;
		switch (status) {
		case TALKING:
			line = "● " + Component.translatable("emlvoice.hud.talking").getString();
			color = 0xFF55FF55;
			break;
		case NO_MIC:
			line = Component.translatable("emlvoice.hud.nomic").getString();
			color = 0xFFFF5555;
			break;
		case OFF:
			line = Component.translatable("emlvoice.hud.off").getString();
			break;
		case MUTED:
			line = Component.translatable("emlvoice.hud.muted").getString();
			break;
		default:
			break;
		}
		if (line != null) {
			graphics.text(mc.font, line, x, y, color, true);
			y += 11;
		}
		for (Integer id : talking.keySet()) {
			Entity e = mc.level.getEntity(id);
			String name = e != null ? e.getName().getString() : Component.translatable("emlvoice.hud.someone").getString();
			graphics.text(mc.font, "♪ " + name, x, y, 0xFFFFFFFF, true);
			y += 11;
		}
	}
}
