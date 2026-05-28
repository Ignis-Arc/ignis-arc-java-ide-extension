import * as vscode from 'vscode';

interface InstructionDetail {
    opcode: string;
    stack: string;
    description: string;
    details: string;
}

const INSTRUCTION_DB: Record<string, InstructionDetail> = {
    // 1. Invocation Opcodes
    'invokevirtual': {
        opcode: '0xb6',
        stack: '..., objectref, [arg1, [arg2 ...]] ➡️ ..., [result]',
        description: 'Invoke instance method; dispatch based on class.',
        details: 'Calls a non-interface, non-private, non-static instance method. Utilizes dynamic dispatch (vtable lookup) at runtime based on the actual class of the `objectref`.'
    },
    'invokespecial': {
        opcode: '0xb7',
        stack: '..., objectref, [arg1, [arg2 ...]] ➡️ ..., [result]',
        description: 'Invoke instance method; direct invocation of instance initialization, private methods, and superclass methods.',
        details: 'Bypasses dynamic dispatch (vtable lookup) to directly invoke constructors (`<init>`), private methods of the current class, or methods of the superclass (e.g. `super.method()`).'
    },
    'invokestatic': {
        opcode: '0xb8',
        stack: '..., [arg1, [arg2 ...]] ➡️ ..., [result]',
        description: 'Invoke a class (static) method.',
        details: 'Invokes a static method. No `objectref` is needed on the stack. The method is resolved statically at compilation time.'
    },
    'invokeinterface': {
        opcode: '0xb9',
        stack: '..., objectref, [arg1, [arg2 ...]] ➡️ ..., [result]',
        description: 'Invoke interface method.',
        details: 'Invokes a method declared in an interface. Requires dynamic table lookup (itable lookup), which has a slightly higher runtime dispatch overhead compared to `invokevirtual`.'
    },
    'invokedynamic': {
        opcode: '0xba',
        stack: '..., [arg1, [arg2 ...]] ➡️ ..., [result]',
        description: 'Invoke dynamic method (Bootstrap method resolved at runtime).',
        details: 'Introduced in Java 7 to support dynamic languages and used in Java 8+ to implement Lambdas, String concatenation, and Pattern Matching. Resolves a call site dynamically using a user-defined Bootstrap Method (BSM).'
    },

    // 2. Constants & Loading
    'aconst_null': {
        opcode: '0x01',
        stack: '... ➡️ ..., null',
        description: 'Push null onto operand stack.',
        details: 'Pushes the special reference type value `null` onto the operand stack.'
    },
    'iconst_0': {
        opcode: '0x03',
        stack: '... ➡️ ..., 0',
        description: 'Push int constant 0.',
        details: 'Pushes the integer constant `0` onto the operand stack. Highly optimized 1-byte opcode.'
    },
    'iconst_1': {
        opcode: '0x04',
        stack: '... ➡️ ..., 1',
        description: 'Push int constant 1.',
        details: 'Pushes the integer constant `1` onto the operand stack. Highly optimized 1-byte opcode.'
    },
    'iconst_m1': {
        opcode: '0x02',
        stack: '... ➡️ ..., -1',
        description: 'Push int constant -1.',
        details: 'Pushes the integer constant `-1` onto the operand stack.'
    },
    'ldc': {
        opcode: '0x12',
        stack: '... ➡️ ..., value',
        description: 'Push item from runtime constant pool (single byte index).',
        details: 'Loads a constant (int, float, String reference, Class reference, or MethodType) from the runtime Constant Pool at the specified single-byte index.'
    },
    'ldc_w': {
        opcode: '0x13',
        stack: '... ➡️ ..., value',
        description: 'Push item from runtime constant pool (wide index).',
        details: 'Loads a constant from the runtime Constant Pool at the specified two-byte index.'
    },
    'ldc2_w': {
        opcode: '0x14',
        stack: '... ➡️ ..., value',
        description: 'Push long or double from runtime constant pool (wide index).',
        details: 'Loads a long or double constant from the Constant Pool. Takes up two slots on the operand stack.'
    },

    // 3. Loading Local Variables
    'aload': {
        opcode: '0x19',
        stack: '... ➡️ ..., objectref',
        description: 'Load reference from local variable.',
        details: 'Loads a reference (object or array) from the local variable array at the specified index and pushes it onto the stack.'
    },
    'aload_0': {
        opcode: '0x2a',
        stack: '... ➡️ ..., objectref',
        description: 'Load reference from local variable 0 (usually `this`).',
        details: 'Loads the reference in local variable 0. In non-static instance methods, slot 0 is always reserved for the `this` reference.'
    },
    'aload_1': {
        opcode: '0x2b',
        stack: '... ➡️ ..., objectref',
        description: 'Load reference from local variable 1.',
        details: 'Loads the reference in local variable 1 (typically the first parameter of the method).'
    },
    'aload_2': {
        opcode: '0x2c',
        stack: '... ➡️ ..., objectref',
        description: 'Load reference from local variable 2.',
        details: 'Loads the reference in local variable 2.'
    },
    'aload_3': {
        opcode: '0x2d',
        stack: '... ➡️ ..., objectref',
        description: 'Load reference from local variable 3.',
        details: 'Loads the reference in local variable 3.'
    },
    'iload': {
        opcode: '0x15',
        stack: '... ➡️ ..., value',
        description: 'Load int from local variable.',
        details: 'Loads an integer value from the local variable array at the specified index.'
    },
    'iload_0': {
        opcode: '0x1a',
        stack: '... ➡️ ..., value',
        description: 'Load int from local variable 0.',
        details: 'Loads the integer value in local variable 0.'
    },
    'iload_1': {
        opcode: '0x1b',
        stack: '... ➡️ ..., value',
        description: 'Load int from local variable 1.',
        details: 'Loads the integer value in local variable 1.'
    },
    'iload_2': {
        opcode: '0x1c',
        stack: '... ➡️ ..., value',
        description: 'Load int from local variable 2.',
        details: 'Loads the integer value in local variable 2.'
    },
    'iload_3': {
        opcode: '0x1d',
        stack: '... ➡️ ..., value',
        description: 'Load int from local variable 3.',
        details: 'Loads the integer value in local variable 3.'
    },

    // 4. Storing variables
    'astore': {
        opcode: '0x3a',
        stack: '..., objectref ➡️ ...',
        description: 'Store reference into local variable.',
        details: 'Pops an object reference from the stack and stores it into the local variable array at the specified index.'
    },
    'astore_0': {
        opcode: '0x4b',
        stack: '..., objectref ➡️ ...',
        description: 'Store reference into local variable 0.',
        details: 'Pops reference and stores it into local variable 0.'
    },
    'astore_1': {
        opcode: '0x4c',
        stack: '..., objectref ➡️ ...',
        description: 'Store reference into local variable 1.',
        details: 'Pops reference and stores it into local variable 1.'
    },
    'astore_2': {
        opcode: '0x4d',
        stack: '..., objectref ➡️ ...',
        description: 'Store reference into local variable 2.',
        details: 'Pops reference and stores it into local variable 2.'
    },
    'astore_3': {
        opcode: '0x4e',
        stack: '..., objectref ➡️ ...',
        description: 'Store reference into local variable 3.',
        details: 'Pops reference and stores it into local variable 3.'
    },
    'istore': {
        opcode: '0x36',
        stack: '..., value ➡️ ...',
        description: 'Store int into local variable.',
        details: 'Pops an integer value from the stack and stores it into the local variable array at the specified index.'
    },
    'istore_0': {
        opcode: '0x3b',
        stack: '..., value ➡️ ...',
        description: 'Store int into local variable 0.',
        details: 'Pops integer and stores it into local variable 0.'
    },
    'istore_1': {
        opcode: '0x3c',
        stack: '..., value ➡️ ...',
        description: 'Store int into local variable 1.',
        details: 'Pops integer and stores it into local variable 1.'
    },
    'istore_2': {
        opcode: '0x3d',
        stack: '..., value ➡️ ...',
        description: 'Store int into local variable 2.',
        details: 'Pops integer and stores it into local variable 2.'
    },
    'istore_3': {
        opcode: '0x3e',
        stack: '..., value ➡️ ...',
        description: 'Store int into local variable 3.',
        details: 'Pops integer and stores it into local variable 3.'
    },

    // 5. Stack Manipulation
    'dup': {
        opcode: '0x59',
        stack: '..., value ➡️ ..., value, value',
        description: 'Duplicate the top operand stack value.',
        details: 'Duplicates the top value on the operand stack. Highly optimized and frequently used during constructor invocation and field assignment.'
    },
    'pop': {
        opcode: '0x57',
        stack: '..., value ➡️ ...',
        description: 'Pop the top operand stack value.',
        details: 'Pops the top single-word value from the stack and discards it.'
    },
    'swap': {
        opcode: '0x5f',
        stack: '..., value2, value1 ➡️ ..., value1, value2',
        description: 'Swap the top two operand stack values.',
        details: 'Swaps the top two single-word values on the stack. Can only operate on Category 1 computational types (single-word values).'
    },

    // 6. Object Creation & Type
    'new': {
        opcode: '0xbb',
        stack: '... ➡️ ..., objectref',
        description: 'Create new object.',
        details: 'Allocates memory for a new instance of the class resolved from the Constant Pool index. Pushes the uninitialized `objectref` onto the stack.'
    },
    'checkcast': {
        opcode: '0xc0',
        stack: '..., objectref ➡️ ..., objectref',
        description: 'Check whether object is of given type.',
        details: 'Checks if `objectref` can be cast to the specified type. Throws `ClassCastException` at runtime if the cast is invalid.'
    },
    'instanceof': {
        opcode: '0xc1',
        stack: '..., objectref ➡️ ..., result',
        description: 'Determine if object is of given type.',
        details: 'Pops `objectref`, checks if it is an instance of the specified type, and pushes `1` (true) or `0` (false) onto the stack.'
    },

    // 7. Fields Access
    'getstatic': {
        opcode: '0xb2',
        stack: '... ➡️ ..., value',
        description: 'Get static field of class.',
        details: 'Loads the value of a static class field from the Constant Pool index and pushes it onto the operand stack.'
    },
    'putstatic': {
        opcode: '0xb3',
        stack: '..., value ➡️ ...',
        description: 'Set static field of class.',
        details: 'Pops `value` from the stack and sets it as the value of a static class field.'
    },
    'getfield': {
        opcode: '0xb4',
        stack: '..., objectref ➡️ ..., value',
        description: 'Fetch field from object.',
        details: 'Pops `objectref`, fetches the value of the instance field at the Constant Pool index, and pushes it onto the stack.'
    },
    'putfield': {
        opcode: '0xb5',
        stack: '..., objectref, value ➡️ ...',
        description: 'Set field in object.',
        details: 'Pops `value` and `objectref` from the stack, and sets the value of the instance field in the object.'
    },

    // 8. Returns & Control Flow
    'return': {
        opcode: '0xb1',
        stack: '... ➡️ [empty]',
        description: 'Return void from method.',
        details: 'Returns `void` from the active method, popping the current frame and returning control to the caller.'
    },
    'ireturn': {
        opcode: '0xac',
        stack: '..., value ➡️ [empty]',
        description: 'Return int (or boolean, char, byte, short) from method.',
        details: 'Pops an integer value from the stack and returns it to the caller, terminating the current method frame.'
    },
    'areturn': {
        opcode: '0xb0',
        stack: '..., objectref ➡️ [empty]',
        description: 'Return reference from method.',
        details: 'Pops an object or array reference from the stack and returns it to the caller.'
    },
    'goto': {
        opcode: '0xa7',
        stack: '[no change]',
        description: 'Branch always.',
        details: 'Unconditional jump to the specified target instruction offset.'
    },

    // 9. Operations
    'iadd': {
        opcode: '0x60',
        stack: '..., value1, value2 ➡️ ..., result',
        description: 'Add two ints.',
        details: 'Pops `value1` and `value2`, performs integer addition (`value1 + value2`), and pushes the result.'
    },
    'isub': {
        opcode: '0x64',
        stack: '..., value1, value2 ➡️ ..., result',
        description: 'Subtract two ints.',
        details: 'Pops `value1` and `value2`, performs integer subtraction (`value1 - value2`), and pushes the result.'
    },
    'iinc': {
        opcode: '0x84',
        stack: '[no stack change]',
        description: 'Increment local variable by constant.',
        details: 'Increments the integer value in the local variable array directly at the specified index by a signed constant value. Bypasses the operand stack entirely for speed.'
    }
};

export function getInstructionHover(word: string): vscode.Hover | undefined {
    // Normalize word (remove commas, semicolons, brackets, or leading/trailing whitespace)
    const cleanWord = word.trim().toLowerCase();
    
    const detail = INSTRUCTION_DB[cleanWord];
    if (!detail) {
        return undefined;
    }

    const markdown = new vscode.MarkdownString();
    markdown.supportHtml = true;
    
    markdown.appendMarkdown(`### ⚡ JVM Bytecode: **${cleanWord}**\n`);
    markdown.appendMarkdown(`*   **Opcode Hex**: \`${detail.opcode}\`\n`);
    markdown.appendMarkdown(`*   **Stack Transition**: \`${detail.stack}\`\n\n`);
    markdown.appendMarkdown(`---\n\n`);
    markdown.appendMarkdown(`**Description:**\n${detail.description}\n\n`);
    markdown.appendMarkdown(`**JVM Mechanics & Details:**\n${detail.details}\n\n`);
    markdown.appendMarkdown(`---\n`);
    markdown.appendMarkdown(`*Ignis Arc Bytecode Navigator v0.1.6*`);

    return new vscode.Hover(markdown);
}
