# Ignis Arc Java IDE Extension Pack (焱虹 Java IDE 擴充包)

[![Visual Studio Marketplace](https://img.shields.io/badge/Marketplace-Ignis_Arc_Java-6F2DA8?style=for-the-badge&logo=visual-studio-code)](https://github.com/Ignis-Arc/ignis-arc-java-ide-extension)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-VS_Code-007ACC?style=for-the-badge&logo=visual-studio-code)](https://code.visualstudio.com/)

這是一款為 VS Code 量身打造的 Java 開發強化套件。結合了重量級 IDE (IntelliJ IDEA / Eclipse) 級別的**專案樹導航、外部依賴庫瀏覽、源碼一鍵反編譯**能力，以及**即時方法複雜度 Code Lenses 分析**，為您提供無比流暢、輕量且精緻的 Java 開發體驗。

---

> [!IMPORTANT]  
> **擴充套件依賴說明：**  
> 本套件做為高性能開發輔助包，嚴格依賴於 **[Language Support for Java(TM) by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.java)** (`redhat.java`)。  
> 為了避免像傳統工具一樣啟動多個沉重的 Java 進程，本套件編譯為 OSGi 外掛包，**直接載入並運行於 Red Hat 共享的 JDT LS JVM 進程中**，確保零額外記憶體與 CPU 開銷。

---

## 🎨 特色功能

### 1. Ignis Arc Java Explorer (原生感檔案與依賴導航樹)
捨棄雜亂的 Package 扁平清單，Explorer 呈現極其整潔的原生目錄結構，並完美整合動態 Java 依賴庫：
*   **原生目錄結構**：完全模擬 VS Code 原生檔案總管，檔案與資料夾按字母順序排列（資料夾優先）。
*   **動態主題圖示**：透過將檔案與虛擬節點映射至 `resourceUri`，**100% 繼承您當前啟動的 VS Code 檔案圖示主題**（如 *Material Icon Theme* 或 *vscode-icons*）！不論是資料夾、Maven `pom.xml`、Gradle `build.gradle`、`.java` 類別還是 `.jar` 庫，皆能展現完美配色！
*   **JDK 與外部依賴庫容器**：
    *   **JDK System Library**：動態展示當前專案對接的 JRE 容器名稱（例如 `JDK System Library [JavaSE-21]`）。
    *   **Referenced Libraries**：列出專案所有的 Maven、Gradle 以及自訂引入的 `.jar` 第三方依賴庫。
*   **依賴庫懶載入瀏覽**：展開 JAR 檔案時才向 JDT LS 請求載入 package，展開 package 時才載入 compiled `.class` 檔案。即使在超大型專案中依然順滑無比。
*   **一鍵源碼反編譯**：只需雙擊依賴庫中的任何 `.class` 檔案，即可透過 JDT LS 的 `jdt://` 協定**自動反編譯並在編輯器中以全語法高亮展示原始碼**！
*   **智慧活動列隱藏**：焱虹的火焰活動列圖標會在外掛識別到 Java 專案時（透過 `workspaceContains:` 原生偵測）自動出現在左側，而在非 Java 專案中則會完全自動隱藏，保持開發介面純淨。

---

### 2. Ignis Arc Complexity Lens (方法級別圈複雜度計量)
在每個 Java 方法定義上方動態渲染圈複雜度計量，幫助您隨時掌握程式碼的健康度與可維護性：
*   **即時燈號狀態**：
    *   `🟢 Low` (複雜度 < 5)：結構簡單，易於測試與維護。
    *   `🟡 Moderate` (複雜度 5 - 9)：結構中等，隨時注意其是否過度膨脹。
    *   `🔴 High` (複雜度 >= 10)：圈複雜度過高，強烈建議進行程式碼重構（Refactoring）。
*   **互動式複雜度分析對話框**：點擊複雜度 Lenses，即可彈出精美對話視窗，向您說明具體的圈複雜度分數、評級，並提供量身打造、具體可執行的重構建議。

---

## ⚙️ 套件設定項目

您可以在 VS Code 的全域設定或工作區 `settings.json` 中自訂以下屬性：

| 設定屬性名稱 | 類型 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| `ignis.java.complexity.enabled` | `boolean` | `true` | 是否在 Java 方法上方顯示圈複雜度 Code Lenses。 |
| `ignis.java.complexity.mediumThreshold` | `integer` | `5` | 判定為中等複雜度 (`🟡 Moderate`) 的起步分數。 |
| `ignis.java.complexity.highThreshold` | `integer` | `10` | 警告並判定為高複雜度 (`🔴 High`) 的門檻分數。 |

---

## ⚡ 底層架構設計理念 (Architecture)

傳統的 Java 代碼計量或專案樹輔助外掛，往往會啟動一個甚至多個背景 Java 進程（例如 SonarLint），這會為系統帶來巨大的記憶體與 CPU 負擔。

**Ignis Arc Java IDE Extension Pack** 透過以下方式達成極致效能：
1.  **100% 共享 JVM 進程**：編譯為 **Eclipse Equinox OSGi 外掛包**，直接載入並運行於 `vscode-java` 啟動的 Language Server 內部。
2.  **零多餘開銷**：直接共享 JDT 內建的 AST 解析器、classpath 解析器與資料庫索引。不產生額外的 JVM 進程，節省系統記憶體。
3.  **OSGi 命令代理**：前端 TypeScript 只需發送極輕量的 workspace command (`java.execute.workspaceCommand`)，即可直接調用 JVM 內部的 JDT API。

---

## 🔧 開發者與建置指引

專案配置了完全自給自足的編譯工具鏈，免除本地開發機的 JDK 設定限制：

### 前置準備
*   `Bun` 或 `Node.js` (用於編譯前端 TS 與封裝 VSIX)
*   標準 Java JRE (由系統提供)

### 編譯與打包指令
1.  **重新編譯與打包套件**：
    執行主指令碼，以 Eclipse 批次編譯器 (ECJ) 編譯 OSGi 後端、編譯 TypeScript，並自動輸出最佳化的 `.vsix` 安裝檔：
    ```bash
    chmod +x pack.sh
    ./pack.sh
    ```
2.  **在 VS Code 中安裝 / 更新**：
    ```bash
    code --install-extension ignis-arc-java-ide-extension-0.1.0.vsix
    ```
3.  **清除快取**：
    每次更新後端 JAR 檔案後，強烈建議在 VS Code 中開啟命令面板 (`Ctrl+Shift+P`) 執行 **`Java: Clean Java Language Server Workspace`**，以強制 Equinox 載入全新的外掛指令。

---

## 📄 授權條款
本專案採用 MIT 授權條款。詳見 `LICENSE` 檔案。

---

由 **Ignis Arc (焱虹)** 傾心設計與打磨 🧡。
