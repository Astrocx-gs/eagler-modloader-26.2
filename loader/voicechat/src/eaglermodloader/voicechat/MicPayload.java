package eaglermodloader.voicechat;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** A frame recorded by the player's microphone, sent to the server. */
public record MicPayload(byte[] frame) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<MicPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(VoiceChat.MOD_ID, "mic"));
	public static final StreamCodec<RegistryFriendlyByteBuf, MicPayload> CODEC = CustomPacketPayload.codec(MicPayload::write, MicPayload::read);

	private void write(RegistryFriendlyByteBuf buf) {
		buf.writeByteArray(this.frame);
	}

	private static MicPayload read(RegistryFriendlyByteBuf buf) {
		return new MicPayload(buf.readByteArray(VoiceChat.MAX_FRAME));
	}

	@Override
	public CustomPacketPayload.Type<MicPayload> type() {
		return TYPE;
	}
}
