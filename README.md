# Ignis Arc Java IDE Extension Pack

[![Visual Studio Marketplace](https://img.shields.io/badge/Marketplace-Ignis_Arc_Java-6F2DA8?style=for-the-badge&logo=visual-studio-code)](https://github.com/Ignis-Arc/ignis-arc-java-ide-extension)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-VS_Code-007ACC?style=for-the-badge&logo=visual-studio-code)](https://code.visualstudio.com/)

A premium, high-performance VS Code extension pack designed to bring the deep **project navigation, dependency browsing, decompilation, and code review power** of heavyweight IDEs (IntelliJ IDEA / Eclipse) directly into VS Code, with **zero extra JVM process memory overhead** and **real-time codebase metrics analysis**.

---

> [!IMPORTANT]  
> **Extension Dependency & Co-processing:**  
> This extension strictly depends on **[Language Support for Java(TM) by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.java)** (`redhat.java`).  
> Rather than spawning a separate heavy Java process, it compiles into an OSGi bundle that loads **directly inside the shared JDT LS JVM process** to ensure zero extra CPU and memory footprint.

---

## 🎨 Features

### 1. Ignis Arc Java Explorer (Native-Theme & Filesystem Integration)
The Explorer renders a clean, native directory tree combined with dynamic Java Libraries:
*   **Native Directory Trees**: Mimics VS Code's native file explorer with files and folders ordered alphabetically (folders first).
*   **Active Theme Integration**: Uses file `resourceUri` mapping with a custom `jdt-class` scheme to automatically inherit your active **VS Code File Icon Theme** (e.g. *Material Icon Theme* or *vscode-icons*) for files, folders, Maven `pom.xml`, Gradle `build.gradle`, `.java` classes, and `.jar` libraries without triggering any filesystem query overhead!
*   **JDK & External Dependency Containers**:
    *   **JDK System Library**: Displays the JRE container labeled dynamically with your active JDK environment (e.g., `JDK System Library [java-21-openjdk-amd64]`).
    *   **Referenced Libraries**: Lists all Maven, Gradle, and user-referenced external `.jar` dependencies.
*   **Lazy-Loaded Dependency Browser**: Expands JARs to lazy-load packages, and packages to lazy-load class files directly from the JDT LS index—yielding zero lag even in massive projects.
*   **Instant Class Decompiler**: Simply double-click any compiled `.class` file in your referenced libraries to **decompile and display its source code with full syntax highlighting** natively via Red Hat JDT LS `jdt://` protocol.
*   **Smart Activity Bar Visibility**: The Ignis Arc Sidebar Icon automatically shows up when a Java project is detected (via active search checks for `pom.xml`, `build.gradle`, or `*.java` files) and completely hides in non-Java workspaces, keeping your sidebar clean.

### 2. Ignis Arc Complexity Analyzer Sidebar (NEW 🚀)
A premium code-review sidebar panel that dynamically scans your active Java workspace for complex methods, sorting them by cyclomatic complexity to help you instantly spot refactoring hot paths:
*   **McCabe Cyclomatic Complexity Standard**: Scans your source files for decision paths + 1, including looping constructs (`for`, `while`, `do-while`, enhanced `for`), conditionals (`if`), catch clauses (`catch`), switch branches (`case`), short-circuit logical operators (`&&`, `||`), and **ternary conditional operators (`? :`)**.
*   **Method Name Line Snapping & Lombok Filtering**: 
    *   Complexity is computed and displayed precisely on the method name's line rather than overlapping on annotations.
    *   Compiler-synthesized and Lombok-generated methods (e.g., `@EqualsAndHashCode`) are automatically filtered out, ensuring your dashboard focuses purely on developer-written code.
*   **Dynamic Go-to Jump**: Click on any method in the sideview tree list to instantly open the corresponding `.java` file, highlight the method signature line, and center the editor viewport on it.
*   **Save-Driven Debounced Scan**: Automatically refreshes the sidebar list upon saving a `.java` file with a 500ms debounce to prevent disk IO and CPU overload.

### 3. Specialized OOP Usages & Implementations Code Lenses (NEW 🔗)
A highly optimized, thread-safe Code Lens provider that displays the active usages, implementations, or inheritance metrics directly above your Java elements:
*   **OOP Specialized Roles**: 
    *   **For Interfaces**: Automatically queries and displays **`🔗 X implementations`** (e.g., `🔗 3 implementations`). Clicking on it slides open VS Code's native Peek View, listing all implementer classes!
    *   **For Classes**: Queries and displays **`🔗 X subclasses`** (e.g., `🔗 2 subclasses`) if the class is inherited, and seamlessly falls back to **`🔗 X usages`** if it is a concrete class.
    *   **For Enums, Methods, Fields, Constants, and Enum Members**: Tracks general references, displaying **`🔗 X usages`**.
*   **Definitions Filtering**: References counts automatically filter out the symbol's own declaration location, allowing never-referenced variables to accurately display **`🔗 no usages`** (or `🔗 no implementations`).
*   **Double-Stage Lazy Resolution (Performance-First ⚡)**:
    *   *provideCodeLenses*: Fast-scans the active document's symbols hierarchically without querying the LSP, guaranteeing zero editing delay.
    *   *resolveCodeLens*: Queries references **only when the Code Lens actually scrolls into your viewport**. Scales perfectly in enterprise-scale codebases!

---

## ⚙️ Extension Settings

You can customize thresholds, toggles, and features in your global VS Code `settings.json`:

| Configuration Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `ignis.java.complexity.enabled` | `boolean` | `true` | Enable showing cyclomatic complexity lenses above Java methods. |
| `ignis.java.complexity.mediumThreshold` | `integer` | `5` | Lower bound complexity score to classify as `🟡 Moderate`. |
| `ignis.java.complexity.highThreshold` | `integer` | `10` | Warning complexity score to classify as `🔴 High` (refactoring recommended). |
| `ignis.java.complexity.criticalThreshold` | `integer` | `20` | Threshold score to classify as `🔴 Critical` in the Complexity Analyzer sidebar. |
| `ignis.java.references.enabled` | `boolean` | `true` | Enable showing dynamic references/usages, implementations, and subclasses Code Lenses. |

---

## ⚡ Under the Hood (Architecture & Design)

Traditional Java extensions launch multiple background JVM processes to compute code metrics or display projects, incurring massive CPU and memory penalties.

**Ignis Arc Java IDE Extension Pack** achieves maximum efficiency by:
1.  **100% JVM Sharing**: Compiles into an **Eclipse Equinox OSGi Plugin Bundle** that loads directly inside `vscode-java`'s active Language Server process (Eclipse JDT LS).
2.  **Zero Overhead**: Shares JDT's built-in AST parser, classpath resolution engine, and index database. Zero extra Java processes are spawned, ensuring lightweight memory footprints.
3.  **Client-Server OSGi Command Delegates**: Translates lightweight frontend TypeScript requests to Equinox-delegated commands (`java.execute.workspaceCommand`) executed directly on the running JVM.

---

## 🔧 Developer & Build Guide

The project includes a completely self-contained compiler and packaging pipeline that bypasses local JDK environment corruption:

### Prerequisites
*   `Bun` or `Node.js` (for TypeScript compilation and VSIX packaging)
*   Standard Java JRE (already provided by system)

### Build & Package Commands
1.  **Recompile & Package Extension**:
    Run the entry shell script to compile the Equinox backend via Eclipse Batch Compiler (ECJ), transpile TypeScript, and output the optimized `.vsix` package:
    ```bash
    chmod +x pack.sh
    ./pack.sh
    ```
2.  **Install/Update in VS Code**:
    ```bash
    code --install-extension ignis-arc-java-ide-extension-0.1.3.vsix
    ```
3.  **Clean Cache**:
    Always run `Java: Clean Java Language Server Workspace` from the VS Code command palette (`Ctrl+Shift+P`) after updating the backend JAR to force Equinox to load the fresh plugin commands.

---

## 📄 License
Distributed under the MIT License. See `LICENSE` for more information.

---

Designed with 🧡 by **Ignis Arc**.
