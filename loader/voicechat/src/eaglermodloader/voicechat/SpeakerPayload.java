package eaglermodloader.voicechat;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** A frame another player said, sent by the server to the players near them. */
public record SpeakerPayload(int entityId, byte[] frame) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<SpeakerPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(VoiceChat.MOD_ID, "speaker"));
	public static final StreamCodec<RegistryFriendlyByteBuf, SpeakerPayload> CODEC = CustomPacketPayload.codec(SpeakerPayload::write, SpeakerPayload::read);

	private void write(RegistryFriendlyByteBuf buf) {
		buf.writeVarInt(this.entityId);
		buf.writeByteArray(this.frame);
	}

	private static SpeakerPayload read(RegistryFriendlyByteBuf buf) {
		int id = buf.readVarInt();
		return new SpeakerPayload(id, buf.readByteArray(VoiceChat.MAX_FRAME));
	}

	@Override
	public CustomPacketPayload.Type<SpeakerPayload> type() {
		return TYPE;
	}
}
