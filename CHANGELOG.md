# Changelog

All notable changes to the **Ignis Arc Java IDE Extension Pack** will be documented in this file.

## [0.1.8] - 2026-05-29

This release introduces a stunning, built-in **Ignis Arc Obsidian Dark** color theme, adds a gorgeous offline-capable **Interactive Theme Generator Workbench (WYSIWYG)**, adds bulletproof, generalized Lombok & synthetic symbol filtering across all DocumentSymbol kinds, eliminating duplicate/redundant Code Lenses on class annotations, and refines the side-by-side screenshot gallery in both READMEs for a premium marketplace presentation.

### Added
*   **Interactive Theme Generator Workbench (WYSIWYG)**: Created a beautiful, offline-capable single page web application in `workbench/index.html` allowing developers to customize editor colors, UI parameters, and syntax tokens via real-time live preview inside a simulated VS Code environment, with one-click JSON exporting and preset loading.
*   **Ignis Arc Obsidian Dark Theme**: Designed a brand-aligned, high-fidelity dark color theme built natively into the extension pack, featuring a deep obsidian charcoal background (`#0C0E12`), fiery orange/red control flows (`#FA9E42` / `#E24A35`), and aurora violet class and type mappings (`#B794F4`).

### Fixed
*   **Generalized Lombok/Synthetic Symbol Filtering**: Upgraded `isSyntheticSymbol` in the Code Lens provider to inspect and filter all document symbol kinds (not just methods or classes). This completely removes duplicate `🔗 X usages` lenses generated for class-level Lombok annotations like `@Data` and `@Builder` (e.g., `equals`, `hashCode`, `toString`, `canEqual` being misclassified by LSP as non-method types).
*   **Pristine Subclass Peek Views**: Strengthened filtering to ensure synthetic inner builder classes (like `UserBuilder` via `@Builder`) do not populate subclass peek views, keeping subclass/implementation lenses clean and accurate.

---

## [0.1.7] - 2026-05-29

This release adds a highly requested Local Variable Table (LVT) Explorer for compiled JVM bytecode, and implements double-stage method lenses that concurrently resolve both method invocations and implementation overrides.

### Added
*   **Local Variable Table (LVT) Explorer**: Extends the ASM-based decompiler backend via a custom `IgnisMethodTextifier` subclass. Bytecode method definitions now display a clean, sorted ASCII table mapping raw JVM registers/slots to handwritten parameter and variable names with their corresponding type descriptors.
*   **Double-Stage Method Lenses**: Upgraded references resolution for `Method` and `Function` symbols to concurrently run both Reference and Implementation providers, allowing method lenses to cleanly distinguish between calls (`usages`) and overrides (`implementations`).
*   **Enhanced Clickable Targets**: Methods and functions now union their usages and implementations into their click arguments. The lens remains 100% clickable even if usages count is `0`, falling back gracefully to implementation peek views.

---

## [0.1.6] - 2026-05-28

This release brings interactive, dual-pane JVM bytecode scroll synchronization, a hover explanation system, and Constant Pool decoding.

### Added
*   **Synchronized Scroll & Highlighting**: Integrates real-time, bidirectional scroll synchronization between handwritten Java source code and decompiled bytecode via ASM line number tracing.
*   **Constant Pool Explorer**: Automatically extracts and displays the full class constant pool at the top of the decompilation view, detailing strings, constants, and references.
*   **JVM Instruction Hovers**: Hovering over any bytecode instruction mnemonic shows a detailed Operand Stack transition diagram and runtime execution description.

---

## [0.1.5] - 2026-05-28

Initial release of the ASM-powered split-screen JVM bytecode decompiler.

### Added
*   **ASM Bytecode Decompiler**: Swaps text-based class disassembly for a high-fidelity, ASM-powered decompiler showing complete JVM instructions, stack sizes, and local registers natively in VS Code.

---

## [0.1.4] - 2026-05-28

This release introduces bulletproof JRE container library querying and high-fidelity reference filters (removing class declarations, constructors, and imports) to deliver the ultimate clean Code Review experience.

### Added
*   **High-Fidelity References Filtering**:
    *   Imports and package statements (e.g., `import com.example.MyClass;`) are now strictly filtered out from the reference count, ensuring unused imports do not inflate usage stats.
    *   Class declaration headers and constructor declarations are now perfectly identified via the JDT DocumentSymbol compiler AST and filtered out, resolving the self-referencing "1 usage" bug for unused classes and constructors.
*   **JRE Container-Driven Library Resolution**: Replaced container entry guessing with a 100% robust, two-phase container path mapping. Package fragment roots are now classified by JRE Container inclusion resolved directly by JDT LS, showing Java platform libraries perfectly under the `JDK System Library` tree.

### Fixed
*   **Filtered Unnamed Packages**: Filtered out unnamed/default package fragments (`""`) from modular libraries and JARs to completely eliminate blank lines (`> [empty label]`) in the explorer tree view.
*   **Polished Dependency Icons**: Configured `NodeType.LibraryJar` nodes to display VS Code's native `file-zip` icon instead of generic folder icons, providing a sleek, IntelliJ-style dependency tree interface.

---

## [0.1.3] - 2026-05-28

This release focuses on advanced OOP specialized Code Lenses, support for Enum constant tracking, and high-precision architectural reviews for industrial stability.

### Added
*   **Specialized Implementation & Subclass Lenses**: 
    *   Interfaces now display `🔗 X implementations` (querying the JDT LS `ImplementationProvider`).
    *   Classes now dynamically show `🔗 X subclasses` if inherited/subclassed, and seamlessly fall back to `🔗 X usages` for terminal concrete classes.
*   **Enum Member Reference Tracking**: Extended references tracking to `vscode.SymbolKind.EnumMember` to perfectly count usages of individual enum constants (e.g., `RED`, `GREEN`, `BLUE`).
*   **Java Workspace Context Detection**: Implemented search-driven Java project detection using `vscode.workspace.findFiles` to dynamically set the custom context context so the Ignis Arc Explorer and Complexity sidebar are hidden in non-Java workspaces.
*   **Strict Dependency Declaration**: Declared `redhat.java` in `"extensionDependencies"` inside `package.json` to ensure VS Code automatically manages and activates the Red Hat Java extension.
*   **Definitions Filtering**: References/usages count now filters out the symbol's own declaration/definition location, allowing never-used symbols to correctly display `🔗 no usages` or `🔗 no implementations`.

### Changed
*   **JRE Container API-Driven Classification**: Replaced path string guessing with a robust, platform-independent check using `root.getRawClasspathEntry()`. Binary packages belonging to container paths containing `JRE_CONTAINER` are now 100% reliably identified across Linux, macOS, Windows, and WSL.
*   **Debounced Save-Driven Scans**: Added a 500ms debounce to the Complexity Analyzer workspace scans triggered by local file saves, reducing AST parsing and disk IO load.
*   **Thread-Safe Tab-Safe Code Lenses**: Subclassed `vscode.CodeLens` to store the active document URI on creation, preventing tab-switching races and misalignment during async resolution.
*   **Custom Scheme for Tree Icons**: Changed `IgnisJavaTreeItem` class node's URI to use a custom `jdt-class` scheme (`vscode.Uri.from({ scheme: 'jdt-class', path: '/' + label })`), preventing Git and filesystem query stat overheads on non-existent root files.
*   **Command Delegation Registration**: Registered the `ignis.java.complexity.scanWorkspace` command inside `plugin.xml` to prevent security delegateCommand dispatch blockages in JDT LS.

---

## [0.1.2] - 2026-05-27

Introduced the Ignis Arc Complexity Analyzer sidebar tree view panel and complete McCabe Cyclomatic Complexity calculations.

### Added
*   **Ignis Arc Complexity Analyzer Sideview**: Added a dedicated review panel listing complex methods in descending order of cyclomatic complexity.
*   **Go-to-Code Signature Snapping**: Clicking a method in the sideview automatically opens the file, selects the signature, and centers the editor viewport.
*   **Ternary Operator Support in Cyclomatic Complexity**: Integrated support for JDT `ConditionalExpression` nodes into the complexity calculator, incrementing McCabe scores by `1` for each ternary operator `? :`.
*   **Method Name Line Snapping**: Code Lenses are now anchored precisely above the method name's line (`node.getName().getStartPosition()`) instead of the annotations line.
*   **Lombok Synthetic Method Filtering**: Implemented a structural AST check (`body.getStartPosition() <= name.getStartPosition()`) to filter out Lombok-synthesized methods, focusing analysis purely on developer-written code.

---

## [0.1.1] - 2026-05-27

Transitioned backend queries to official APIs, fixing Equinox global project loop conflicts.

### Added
*   **Red Hat Classpaths API Migration**: Swapped custom queries for the official `api.getClasspaths` query interface.
*   **Dynamic JRE Container Naming**: Extracted folder names from system JRE paths to render descriptive JRE container titles in the tree explorer (e.g. `JDK System Library [java-21-openjdk-amd64]`).
*   **Dual-Mode Package Resolution**: Upgraded JDT LS backend to handle both absolute JAR paths and standard JDT internal handles.

---

## [0.1.0] - 2026-05-27

Initial release of the **Ignis Arc Java IDE Extension Pack**.

### Added
*   **Ignis Arc Java Explorer**: A native-theme file and Java dependency tree explorer.
*   **Instant Class Decompiler**: Dynamic `.class` decompilation directly via Red Hat JDT LS `jdt://` protocol.
*   **Cyclomatic Complexity Code Lenses**: Interactive method cyclomatic complexity lenses and advice dialogs.
