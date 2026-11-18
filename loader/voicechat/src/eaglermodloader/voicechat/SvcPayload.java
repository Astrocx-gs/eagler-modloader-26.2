package eaglermodloader.voicechat;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * A Simple Voice Chat plugin message (channel voicechat:*), kept as raw bytes: its layout changes between
 * Simple Voice Chat versions, so SimpleVoiceChat reads and writes the bytes itself.
 */
public record SvcPayload(CustomPacketPayload.Type<SvcPayload> type, byte[] data) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<SvcPayload> REQUEST_SECRET = type("request_secret");
	public static final CustomPacketPayload.Type<SvcPayload> SECRET = type("secret");
	/** The player's state, for versions 18 and 20: disabled. */
	public static final CustomPacketPayload.Type<SvcPayload> UPDATE_STATE = type("update_state");
	/** The player's state, for version 21: muted, disabled. */
	public static final CustomPacketPayload.Type<SvcPayload> CLIENT_STATE = type("client_state");

	private static CustomPacketPayload.Type<SvcPayload> type(String path) {
		return new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("voicechat", path));
	}

	public static StreamCodec<RegistryFriendlyByteBuf, SvcPayload> codec(CustomPacketPayload.Type<SvcPayload> type) {
		return CustomPacketPayload.codec((SvcPayload payload, RegistryFriendlyByteBuf buf) -> buf.writeBytes(payload.data), buf -> {
			byte[] data = new byte[buf.readableBytes()];
			buf.readBytes(data);
			return new SvcPayload(type, data);
		});
	}
}
