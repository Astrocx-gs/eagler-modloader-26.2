package org.lwjgl.system;

public interface Pointer {
    int POINTER_SIZE = 4;
    int POINTER_SHIFT = 2;
    boolean BITS32 = true;
    boolean BITS64 = false;

    long address();
}
