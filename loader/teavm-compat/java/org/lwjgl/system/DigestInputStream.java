package java.security;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Genuine java.security.DigestInputStream implementation for TeaVM.
 */
public class DigestInputStream extends FilterInputStream {

    protected MessageDigest digest;
    private boolean on = true;

    public DigestInputStream(InputStream stream, MessageDigest digest) {
        super(stream);
        setMessageDigest(digest);
    }

    public MessageDigest getMessageDigest() {
        return digest;
    }

    public void setMessageDigest(MessageDigest digest) {
        this.digest = digest;
    }

    @Override
    public int read() throws IOException {
        int ch = in.read();
        if (on && ch != -1 && digest != null) {
            digest.update((byte) ch);
        }
        return ch;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int result = in.read(b, off, len);
        if (on && result != -1 && digest != null) {
            digest.update(b, off, result);
        }
        return result;
    }

    public void on(boolean on) {
        this.on = on;
    }

    @Override
    public String toString() {
        return "[Digest Input Stream] " + digest;
    }
}
