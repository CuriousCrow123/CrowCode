This is a bit. Click it to flip it!

[Widget description: A single square/rectangular card representing a bit. Clicking it will flip it. Flipping should be a beautiful animation that makes it look like a card being flipped.]

Pretty simple right? A single bit can be either 0 or 1. And it can represent various things that have two states:

[Widget description: A single bit on the left with "wires" connecting it to an array of things on the right -- a light bulb that turns off/on, a card that says "TRUE/FALSE", a black/white colored card, a coin with heads/tails]

Every piece of data in your computer -- images, text, audio, software, etc -- is stored in bits.

[Widget description: a large grid of tiny bits -- they randomly flip with a matrix-like transition. I want these mini transitions to look cool and sci-fi. It should continuously randomly flip to simulate how bits in a computer are constantly flipping.]

[Widget description: a sequence of bits representing 2 integers x,y corresponding with an animation of a ball rolling on a sin wave (infinitely looping, left and right edges connected for a smooth transition). The animation should look like real gravity and acceleration without friction.]

Bits represent numbers. And numbers can represent many things. [Footnote: It's not necessary to know exactly how bits represent different kinds of numbers (unsigned int, signed int, float) -- although this topic comes up in CS40A (Assembly Language). It is important to know how big these numbers are (in terms of numbers of bytes) -- we will return to this topic (each data type has a fixed size -- the computer must know how many bits to read to interpret the number/data).]

Numbers represent colors, characters, audio. They can be used to represent anything w/ mappings. [Give example of mappings]

[Widget description: Show a binary representation corresponding with RGB, another one with characters/strings, and another one with an audio waveform]

These bits get stored in the RAM.

[Widget description: similar to the large grid of tiny bits, except this time, randomly change 8 bits at a time to foreshadow bytes, and that RAM is byte-addressable. Show also a CPU and two wires connecting CPU and RAM and animate signals being passed back and forth. Transforms according to "byte-addressable" link trigger]

Notice how bits are changing in chunks of 8. That's because they are byte-addressable ["byte-addressable" should be a link that triggers a visually animated transformation of the widget above into a two column table of addresses & bytes (with the same tiny bits). The rows should also be matching the "layers" of RAM memory as in conventional C programs: Text (0x08048000) → Data → BSS → Heap (grows up from ~0x08048000+) → free space → Stack (grows down from ~0xBFFFFFFF) → Kernel space (0xC0000000–0xFFFFFFFF). Since this would be way too many bytes to show, simplify by having the transformation animation reorganize the bits so that it shows just a few bytes per section, making use of "dot-dot-dot" to denote there's more that is collapsed. Please think carefully about this]. A byte is a sequence of 8-bits. The most important sections of the RAM for learning programming is the stack and the heap. We will explore these later on.

Addresses are very important . They are how we keep track of where our data are. Now that we have RAM, to store data, we need to process that data. That's where the CPU comes in. They load in **data** from the ram and perform **operations**. For C/C++ or other HLLs we don't need to worry about how this works exactly. We just need to know how to write instructions to create variables and how to assign them things. [This explanation is weak. Please improve]

[Widget description: Shows basic program instructions and multiple views of the memory. Instructions: Variable (1) Declaration, (2) Assignment, (3) evaluation (int b = a+ 3). Memory view #1 ("Box" view): a box with the name on top, data type below, value in box. Memory view #2 ("RAM" view): the two column view (without sections) of address column and byte/bit-sequence column, where the first byte address of an int, for example, is highlighted with the name attached to it to denote that the compiler knows the variable name corresponds with the first address. The full sequence of bytes (therefore multiple rows of the right column) is highlighted/boxed with the data type attached to it to denote that the compiler interprets the variable with the data type.]




