package eaglermodloader.voicechat;

import net.lax1dude.eaglercraft.v1_8.internal.PlatformEmlVoice;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractSliderButton;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/** Voice chat settings (from Mod Menu, or the settings key). Saved in the browser by eml-voice.js. */
public final class VoiceSettingsScreen extends Screen {
	private final Screen parent;
	private boolean testing;
	private int meterY;

	public VoiceSettingsScreen(Screen parent) {
		super(Component.translatable("emlvoice.settings.title"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		int left = this.width / 2 - 155, right = this.width / 2 + 5, y = this.height / 6;
		this.addRenderableWidget(Button.builder(modeLabel(), b -> {
			VoiceChatClient.toggle("mode");
			b.setMessage(modeLabel());
		}).bounds(left, y, 150, 20).build());
		this.addRenderableWidget(Button.builder(enabledLabel(), b -> {
			VoiceChatClient.toggle("enabled");
			b.setMessage(enabledLabel());
		}).bounds(right, y, 150, 20).build());
		y += 24;
		this.addRenderableWidget(new Setting(left, y, "emlvoice.settings.volume", "volume", 0.0F, 2.0F, false));
		this.addRenderableWidget(new Setting(right, y, "emlvoice.settings.mic", "mic", 0.0F, 2.0F, false));
		y += 24;
		this.addRenderableWidget(new Setting(left, y, "emlvoice.settings.threshold", "threshold", -60.0F, 0.0F, true));
		this.addRenderableWidget(Button.builder(testLabel(), b -> {
			this.testing = !this.testing;
			PlatformEmlVoice.setTesting(this.testing);
			b.setMessage(testLabel());
		}).bounds(right, y, 150, 20).build());
		y += 30;
		this.meterY = y;
		this.addRenderableWidget(Button.builder(Component.translatable("gui.done"), b -> this.onClose())
			.bounds(this.width / 2 - 100, this.height - 27, 200, 20).build());
	}

	private static Component modeLabel() {
		return Component.translatable("emlvoice.settings.mode", Component.translatable(VoiceChatClient.voiceMode() ? "emlvoice.settings.mode.voice" : "emlvoice.settings.mode.ptt"));
	}

	private static Component enabledLabel() {
		return Component.translatable("emlvoice.settings.enabled", Component.translatable(PlatformEmlVoice.getSetting("enabled") >= 0.5F ? "options.on" : "options.off"));
	}

	private Component testLabel() {
		return Component.translatable(this.testing ? "emlvoice.settings.test.stop" : "emlvoice.settings.test");
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float a) {
		super.extractRenderState(graphics, mouseX, mouseY, a);
		graphics.centeredText(this.font, this.title, this.width / 2, 15, 0xFFFFFFFF);
		// microphone meter, with the voice activation level marked
		int x0 = this.width / 2 - 155, x1 = this.width / 2 + 155, y = this.meterY;
		graphics.text(this.font, Component.translatable("emlvoice.settings.meter"), x0, y, 0xFFFFFFFF, true);
		y += 12;
		graphics.fill(x0, y, x1, y + 8, 0xFF202020);
		float level = PlatformEmlVoice.micLevel();
		int filled = x0 + Math.round((x1 - x0) * level);
		float threshold = (PlatformEmlVoice.getSetting("threshold") + 60.0F) / 60.0F;
		int mark = x0 + Math.round((x1 - x0) * threshold);
		graphics.fill(x0, y, filled, y + 8, level >= threshold ? 0xFF55FF55 : 0xFF3A7A3A);
		if (VoiceChatClient.voiceMode()) graphics.fill(mark, y - 2, mark + 1, y + 10, 0xFFFFFF55);
		y += 16;
		Component hint = Component.translatable(VoiceChatClient.voiceMode() ? "emlvoice.settings.hint.voice" : "emlvoice.settings.hint.ptt",
			VoiceChatClient.talkKey.getTranslatedKeyMessage(), VoiceChatClient.muteKey.getTranslatedKeyMessage());
		graphics.text(this.font, hint, x0, y, 0xFFAAAAAA, true);
		graphics.text(this.font, Component.translatable("emlvoice.settings.hint.where"), x0, y + 11, 0xFFAAAAAA, true);
	}

	@Override
	public void removed() {
		if (this.testing) PlatformEmlVoice.setTesting(false);
		this.testing = false;
		super.removed();
	}

	@Override
	public void onClose() {
		this.minecraft.gui.setScreen(this.parent);
	}

	/** A slider for one number setting. */
	private static final class Setting extends AbstractSliderButton {
		private final String label, name;
		private final float min, max;
		private final boolean decibels;

		Setting(int x, int y, String label, String name, float min, float max, boolean decibels) {
			super(x, y, 150, 20, Component.empty(), (PlatformEmlVoice.getSetting(name) - min) / (max - min));
			this.label = label;
			this.name = name;
			this.min = min;
			this.max = max;
			this.decibels = decibels;
			this.updateMessage();
		}

		private float current() {
			return this.min + (float) this.value * (this.max - this.min);
		}

		@Override
		protected void updateMessage() {
			float v = this.current();
			String shown = this.decibels ? Math.round(v) + " dB" : Math.round(v * 100.0F) + "%";
			this.setMessage(Component.translatable(this.label, shown));
		}

		@Override
		protected void applyValue() {
			PlatformEmlVoice.setSetting(this.name, this.current());
		}
	}
}
