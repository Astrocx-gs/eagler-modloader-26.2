package org.lwjgl;

import java.nio.ByteBuffer;

/**
 * Browser-compatible LWJGL BufferUtils additions for TeaVM.
 */
public final class BufferUtils {

	private BufferUtils() {
	}

	public static ByteBuffer createByteBuffer(int capacity) {
		return ByteBuffer.allocateDirect(capacity);
	}

	public static void zeroBuffer(ByteBuffer buffer) {
		if (buffer == null) {
			return;
		}
		int pos = buffer.position();
		int lim = buffer.limit();
		for (int i = pos; i < lim; i++) {
			buffer.put(i, (byte) 0);
		}
		buffer.position(pos);
	}
}
