package eaglermodloader.voicechat;

import com.terraformersmc.modmenu.api.ConfigScreenFactory;
import com.terraformersmc.modmenu.api.ModMenuApi;

/** The settings button for Voice Chat in Mod Menu. */
public final class VoiceModMenu implements ModMenuApi {
	@Override
	public ConfigScreenFactory<?> getModConfigScreenFactory() {
		return VoiceSettingsScreen::new;
	}
}
