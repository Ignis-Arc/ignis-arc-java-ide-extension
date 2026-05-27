# Ignis Arc Java IDE Extension Pack

[![Visual Studio Marketplace](https://img.shields.io/badge/Marketplace-Ignis_Arc_Java-6F2DA8?style=for-the-badge&logo=visual-studio-code)](https://github.com/Ignis-Arc/ignis-arc-java-ide-extension)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-VS_Code-007ACC?style=for-the-badge&logo=visual-studio-code)](https://code.visualstudio.com/)

A premium, high-performance VS Code extension pack designed to bring the deep **project navigation, dependency browsing, and decompilation power** of heavyweight IDEs (IntelliJ IDEA / Eclipse) directly into VS Code, with **zero extra JVM process memory overhead** and **real-time method cyclomatic complexity analysis**.

---

> [!IMPORTANT]  
> **Extension Dependency Note:**  
> This extension acts as a high-performance companion pack and strictly depends on **[Language Support for Java(TM) by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.java)** (`redhat.java`).  
> Rather than spawning a separate heavy Java process, it compiles into an OSGi bundle that loads **directly inside the shared JDT LS JVM process** to ensure zero extra CPU and memory footprint.

---

## 🎨 Features

### 1. Ignis Arc Java Explorer (Native-Theme & Filesystem Integration)
The Explorer renders a clean, native directory tree combined with dynamic Java Libraries:
*   **Native Directory Trees**: Mimics VS Code's native file explorer with files and folders ordered alphabetically (folders first).
*   **Active Theme Integration**: Uses file `resourceUri` mapping to automatically inherit your active **VS Code File Icon Theme** (e.g. *Material Icon Theme* or *vscode-icons*) for files, folders, Maven `pom.xml`, Gradle `build.gradle`, `.java` classes, and `.jar` libraries!
*   **JDK & External Dependency Containers**:
    *   **JDK System Library**: Displays the JRE container labeled dynamically with your active JDK environment (e.g., `JDK System Library [JavaSE-21]`).
    *   **Referenced Libraries**: Lists all Maven, Gradle, and user-referenced external `.jar` dependencies.
*   **Lazy-Loaded Dependency Browser**: Expands JARs to lazy-load packages, and packages to lazy-load class files directly from the JDT LS index—yielding zero lag even in massive projects.
*   **Instant Class Decompiler**: Simply double-click any compiled `.class` file in your referenced libraries to **decompile and display its source code with full syntax highlighting** natively via Red Hat JDT LS `jdt://` protocol.
*   **Smart Activity Bar Visibility**: The Ignis Arc Sidebar Icon automatically shows up when a Java project is detected (via `workspaceContains:` globs) and completely hides in non-Java workspaces, keeping your sidebar clean.

---

### 2. Ignis Arc Complexity Lens (Method-level Cyclomatic Complexity)
Keep your codebase readable and maintainable with real-time cyclomatic complexity Code Lenses above every Java method:
*   **Live Heatmap Indicators**:
    *   `🟢 Low` (Complexity < 5): Safe, simple, and maintainable.
    *   `🟡 Moderate` (Complexity 5 - 9): Keep an eye on it as it grows.
    *   `🔴 High` (Complexity >= 10): Highly complex. Consider refactoring.
*   **Interactive Complexity Explainer**: Click on any complexity Code Lens to trigger an interactive dialog showcasing the exact complexity score, rating, and personalized, actionable refactoring recommendations.

---

## ⚙️ Extension Settings

You can customize the rating thresholds and toggles in your global VS Code `settings.json`:

| Configuration Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `ignis.java.complexity.enabled` | `boolean` | `true` | Enable showing cyclomatic complexity lenses above Java methods. |
| `ignis.java.complexity.mediumThreshold` | `integer` | `5` | Lower bound complexity score to classify as `🟡 Moderate`. |
| `ignis.java.complexity.highThreshold` | `integer` | `10` | Warning complexity score to classify as `🔴 High` (refactoring recommended). |

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
    code --install-extension ignis-arc-java-ide-extension-0.1.0.vsix
    ```
3.  **Clean Cache**:
    Always run `Java: Clean Java Language Server Workspace` from the VS Code command palette (`Ctrl+Shift+P`) after updating the backend JAR to force Equinox to load the fresh plugin commands.

---

## 📄 License
Distributed under the MIT License. See `LICENSE` for more information.

---

Designed with 🧡 by **Ignis Arc**.
