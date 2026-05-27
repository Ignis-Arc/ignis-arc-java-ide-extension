import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let jdtlsReady = false;

// ==========================================
// 1. Complexity Lenses Code
// ==========================================

interface MethodMetric {
    name: string;
    complexity: number;
    startLine: number; // 1-indexed
    endLine: number;   // 1-indexed
}

function registerComplexityLens(context: vscode.ExtensionContext) {
    // Command for interactive explanation
    context.subscriptions.push(
        vscode.commands.registerCommand('ignis.java.complexity.explain', (metric: MethodMetric) => {
            const config = vscode.workspace.getConfiguration('ignis.java.complexity');
            const highThreshold = config.get<number>('highThreshold', 10);
            const mediumThreshold = config.get<number>('mediumThreshold', 5);

            let rating = 'Low';
            let advice = 'This function is simple and easy to maintain. Great job!';
            if (metric.complexity >= highThreshold) {
                rating = 'High (Refactoring Recommended)';
                advice = 'This function has too many decision paths. Consider breaking it down into smaller helper methods to improve readability, debuggability, and testability.';
            } else if (metric.complexity >= mediumThreshold) {
                rating = 'Moderate';
                advice = 'This function is moderately complex. Keep an eye on it to ensure it does not grow further.';
            }

            vscode.window.showInformationMessage(
                `Method "${metric.name}" Cyclomatic Complexity: ${metric.complexity} [${rating}]\n\n${advice}`,
                { modal: true }
            );
        })
    );

    // Register Code Lens Providers
    const docSelector: vscode.DocumentSelector = { scheme: 'file', language: 'java' };
    const codeLensProvider = new JavaComplexityCodeLensProvider();
    const referencesLensProvider = new JavaReferencesCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(docSelector, codeLensProvider),
        vscode.languages.registerCodeLensProvider(docSelector, referencesLensProvider)
    );
}

class JavaComplexityCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('ignis.java.complexity')) {
                this._onDidChangeCodeLenses.fire();
            }
        });
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        if (!jdtlsReady) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('ignis.java.complexity');
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
            return [];
        }

        const highThreshold = config.get<number>('highThreshold', 10);
        const mediumThreshold = config.get<number>('mediumThreshold', 5);

        try {
            const metrics = await vscode.commands.executeCommand<MethodMetric[]>(
                'java.execute.workspaceCommand',
                'ignis.java.complexity.calculate',
                document.uri.toString()
            );

            if (!metrics || metrics.length === 0) {
                return [];
            }

            const lenses: vscode.CodeLens[] = [];

            for (const metric of metrics) {
                const line = Math.max(0, metric.startLine - 1);
                const range = new vscode.Range(line, 0, line, 0);

                let rating = '🟢 Low';
                if (metric.complexity >= highThreshold) {
                    rating = '🔴 High';
                } else if (metric.complexity >= mediumThreshold) {
                    rating = '🟡 Moderate';
                }

                const title = `Complexity: ${metric.complexity} (${rating})`;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: title,
                        command: 'ignis.java.complexity.explain',
                        arguments: [metric]
                    })
                );
            }

            return lenses;
        } catch (error) {
            console.error('Error calculating Java complexity:', error);
            return [];
        }
    }
}

class JavaReferencesCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('ignis.java.references')) {
                this._onDidChangeCodeLenses.fire();
            }
        });
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        if (!jdtlsReady) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('ignis.java.references');
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
            return [];
        }

        try {
            // Retrieve all hierarchical document symbols from the active document
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (!symbols || symbols.length === 0) {
                return [];
            }

            const lenses: vscode.CodeLens[] = [];

            const traverse = (syms: vscode.DocumentSymbol[]) => {
                for (const sym of syms) {
                    if (
                        sym.kind === vscode.SymbolKind.Class ||
                        sym.kind === vscode.SymbolKind.Interface ||
                        sym.kind === vscode.SymbolKind.Enum ||
                        sym.kind === vscode.SymbolKind.Method ||
                        sym.kind === vscode.SymbolKind.Constructor ||
                        sym.kind === vscode.SymbolKind.Field ||
                        sym.kind === vscode.SymbolKind.Constant
                    ) {
                        lenses.push(new vscode.CodeLens(sym.selectionRange));
                    }
                    if (sym.children && sym.children.length > 0) {
                        traverse(sym.children);
                    }
                }
            };

            traverse(symbols);
            return lenses;
        } catch (error) {
            console.error('Error providing references Code Lenses:', error);
            return [];
        }
    }

    async resolveCodeLens(
        codeLens: vscode.CodeLens,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            codeLens.command = { title: '🔗 0 usages', command: '' };
            return codeLens;
        }

        try {
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                activeEditor.document.uri,
                codeLens.range.start
            );

            const count = locations ? locations.length : 0;
            const title = `🔗 ${count} usage${count === 1 ? '' : 's'}`;

            codeLens.command = {
                title: title,
                command: 'editor.action.showReferences',
                arguments: [activeEditor.document.uri, codeLens.range.start, locations || []]
            };
        } catch (error) {
            codeLens.command = {
                title: '🔗 0 usages',
                command: ''
            };
        }

        return codeLens;
    }
}

// ==========================================
// 2. Project Navigator Code
// ==========================================

const ignoredNames = new Set(['.git', '.DS_Store', '.settings', '.classpath', '.project']);

enum NodeType {
    ProjectRoot,
    LocalFolder,
    LocalFile,
    SystemLibraryContainer,
    ReferencedLibraryContainer,
    LibraryJar,
    Package,
    Class
}

class IgnisJavaTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: NodeType,
        public readonly pathValue: string,
        public readonly extraData?: any
    ) {
        super(label, collapsibleState);
        this.contextValue = NodeType[type];

        switch (type) {
            case NodeType.ProjectRoot:
                this.resourceUri = vscode.Uri.file(pathValue);
                break;
            case NodeType.LocalFolder:
                this.resourceUri = vscode.Uri.file(pathValue);
                break;
            case NodeType.LocalFile:
                this.resourceUri = vscode.Uri.file(pathValue);
                this.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [this.resourceUri]
                };
                break;
            case NodeType.SystemLibraryContainer:
                this.iconPath = new vscode.ThemeIcon('library');
                break;
            case NodeType.ReferencedLibraryContainer:
                this.iconPath = new vscode.ThemeIcon('library');
                break;
            case NodeType.LibraryJar:
                this.resourceUri = vscode.Uri.file(pathValue);
                break;
            case NodeType.Package:
                this.iconPath = vscode.ThemeIcon.Folder;
                break;
            case NodeType.Class:
                // Set resourceUri to a Java class filename to fetch active theme icons
                this.resourceUri = vscode.Uri.file(label);
                this.command = {
                    command: 'ignis.java.navigator.openFile',
                    title: 'Open Class File',
                    arguments: [extraData] // The decompilable jdt:// URI
                };
                break;
        }
    }
}

class IgnisJavaProjectTreeDataProvider implements vscode.TreeDataProvider<IgnisJavaTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<IgnisJavaTreeItem | undefined | null | void> = new vscode.EventEmitter<IgnisJavaTreeItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<IgnisJavaTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Cache to hold library structures returned by JDT LS
    private projectLibrariesCache = new Map<string, { jreName: string; systemLibraries: any[]; referencedLibraries: any[] }>();

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    clearCache(): void {
        this.projectLibrariesCache.clear();
    }

    getTreeItem(element: IgnisJavaTreeItem): vscode.TreeItem {
        return element;
    }

    private async getProjectLibrariesCached(projectPath: string) {
        if (this.projectLibrariesCache.has(projectPath)) {
            return this.projectLibrariesCache.get(projectPath);
        }
        try {
            const libs = await vscode.commands.executeCommand<any>(
                'java.execute.workspaceCommand',
                'ignis.java.project.getLibraries',
                projectPath
            );
            if (libs) {
                // Avoid caching empty lists while JDT LS is still loading/importing
                if ((!libs.systemLibraries || libs.systemLibraries.length === 0) &&
                    (!libs.referencedLibraries || libs.referencedLibraries.length === 0)) {
                    return null;
                }

                // Refine the JRE label based on path if it is generic
                if (libs.jreName === 'JDK System Library' && libs.systemLibraries && libs.systemLibraries.length > 0) {
                    const firstSystem = libs.systemLibraries.find((lib: any) => lib.path);
                    if (firstSystem) {
                        const pVal = firstSystem.path;
                        const lowerPath = pVal.toLowerCase();
                        let extractedName = '';
                        if (lowerPath.includes('/jvm/')) {
                            const parts = pVal.split(path.sep);
                            const jvmIdx = parts.findIndex((part: string) => part.toLowerCase() === 'jvm');
                            if (jvmIdx !== -1 && jvmIdx + 1 < parts.length) {
                                extractedName = parts[jvmIdx + 1];
                            }
                        } else if (lowerPath.includes('.sdkman/candidates/java/')) {
                            const parts = pVal.split(path.sep);
                            const javaIdx = parts.findIndex((part: string, idx: number) => part.toLowerCase() === 'java' && parts[idx - 1]?.toLowerCase() === 'candidates');
                            if (javaIdx !== -1 && javaIdx + 1 < parts.length) {
                                extractedName = parts[javaIdx + 1];
                            }
                        } else if (lowerPath.includes('javavirtualmachines')) {
                            const parts = pVal.split(path.sep);
                            const jvmIdx = parts.findIndex((part: string) => part.toLowerCase().includes('javavirtualmachines'));
                            if (jvmIdx !== -1 && jvmIdx + 1 < parts.length) {
                                extractedName = parts[jvmIdx + 1];
                            }
                        } else {
                            const dirName = path.basename(path.dirname(path.dirname(pVal)));
                            if (dirName && dirName !== '.' && dirName !== '..' && dirName.length > 2) {
                                extractedName = dirName;
                            }
                        }
                        if (extractedName) {
                            libs.jreName = `JDK System Library [${extractedName}]`;
                        }
                    }
                }

                this.projectLibrariesCache.set(projectPath, libs);
                return libs;
            }
        } catch (e) {
            console.error('Failed to fetch project libraries for:', projectPath, e);
        }
        return null;
    }

    async getChildren(element?: IgnisJavaTreeItem): Promise<IgnisJavaTreeItem[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        // Root Level
        if (!element) {
            if (workspaceFolders.length === 1) {
                // Single root workspace: list all files/folders directly in root
                return this.getDirectoryAndLibraryNodes(workspaceFolders[0].uri.fsPath);
            } else {
                // Multi-root workspace: list project root folders
                return workspaceFolders.map(folder => new IgnisJavaTreeItem(
                    folder.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    NodeType.ProjectRoot,
                    folder.uri.fsPath
                ));
            }
        }

        // Project Root level (for multi-root workspace)
        if (element.type === NodeType.ProjectRoot) {
            return this.getDirectoryAndLibraryNodes(element.pathValue);
        }

        // Local Folders
        if (element.type === NodeType.LocalFolder) {
            const children: IgnisJavaTreeItem[] = [];
            try {
                const dirEntries = await fs.promises.readdir(element.pathValue, { withFileTypes: true });
                const filtered = dirEntries.filter(e => !ignoredNames.has(e.name));
                filtered.sort((a, b) => {
                    if (a.isDirectory() && !b.isDirectory()) { return -1; }
                    if (!a.isDirectory() && b.isDirectory()) { return 1; }
                    return a.name.localeCompare(b.name);
                });

                for (const entry of filtered) {
                    const fullPath = path.join(element.pathValue, entry.name);
                    children.push(new IgnisJavaTreeItem(
                        entry.name,
                        entry.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                        entry.isDirectory() ? NodeType.LocalFolder : NodeType.LocalFile,
                        fullPath
                    ));
                }
            } catch (e) {
                console.error('Failed to read folder contents:', element.pathValue, e);
            }
            return children;
        }

        // System Libraries container
        if (element.type === NodeType.SystemLibraryContainer) {
            const systemLibs = element.extraData as any[];
            if (!systemLibs) { return []; }
            return systemLibs.map(lib => new IgnisJavaTreeItem(
                lib.name,
                vscode.TreeItemCollapsibleState.Collapsed,
                NodeType.LibraryJar,
                lib.path,
                lib.id
            ));
        }

        // Referenced Libraries container
        if (element.type === NodeType.ReferencedLibraryContainer) {
            const referencedLibs = element.extraData as any[];
            if (!referencedLibs) { return []; }
            return referencedLibs.map(lib => new IgnisJavaTreeItem(
                lib.name,
                vscode.TreeItemCollapsibleState.Collapsed,
                NodeType.LibraryJar,
                lib.path,
                lib.id
            ));
        }

        // Library JAR (contains packages)
        if (element.type === NodeType.LibraryJar) {
            const jarHandleId = element.extraData as string;
            try {
                const packages = await vscode.commands.executeCommand<any[]>(
                    'java.execute.workspaceCommand',
                    'ignis.java.library.getPackages',
                    jarHandleId
                );
                if (packages && packages.length > 0) {
                    // Sort packages alphabetically
                    packages.sort((a, b) => a.name.localeCompare(b.name));
                    return packages.map(pkg => new IgnisJavaTreeItem(
                        pkg.name,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        NodeType.Package,
                        '',
                        pkg.id
                    ));
                }
            } catch (e) {
                console.error('Failed to get library packages:', jarHandleId, e);
            }
            return [];
        }

        // Package (contains classes)
        if (element.type === NodeType.Package) {
            const pkgHandleId = element.extraData as string;
            try {
                const classes = await vscode.commands.executeCommand<any[]>(
                    'java.execute.workspaceCommand',
                    'ignis.java.library.getClasses',
                    pkgHandleId
                );
                if (classes && classes.length > 0) {
                    // Sort classes alphabetically
                    classes.sort((a, b) => a.name.localeCompare(b.name));
                    return classes.map(cls => new IgnisJavaTreeItem(
                        cls.name,
                        vscode.TreeItemCollapsibleState.None,
                        NodeType.Class,
                        '',
                        cls.uri
                    ));
                }
            } catch (e) {
                console.error('Failed to get package classes:', pkgHandleId, e);
            }
            return [];
        }

        return [];
    }

    private async getDirectoryAndLibraryNodes(dirPath: string): Promise<IgnisJavaTreeItem[]> {
        const children: IgnisJavaTreeItem[] = [];

        // 1. Read files and directories on disk
        try {
            const dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            const filtered = dirEntries.filter(e => !ignoredNames.has(e.name));
            filtered.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) { return -1; }
                if (!a.isDirectory() && b.isDirectory()) { return 1; }
                return a.name.localeCompare(b.name);
            });

            for (const entry of filtered) {
                const fullPath = path.join(dirPath, entry.name);
                children.push(new IgnisJavaTreeItem(
                    entry.name,
                    entry.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    entry.isDirectory() ? NodeType.LocalFolder : NodeType.LocalFile,
                    fullPath
                ));
            }
        } catch (e) {
            console.error('Failed to read directory:', dirPath, e);
        }

        // 2. Fetch and append Java Libraries if JDT LS is initialized
        if (jdtlsReady) {
            const libs = await this.getProjectLibrariesCached(dirPath);
            if (libs) {
                if (libs.systemLibraries && libs.systemLibraries.length > 0) {
                    const jreLabel = libs.jreName || 'JDK System Library';
                    children.push(new IgnisJavaTreeItem(
                        jreLabel,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        NodeType.SystemLibraryContainer,
                        dirPath,
                        libs.systemLibraries
                    ));
                }
                if (libs.referencedLibraries && libs.referencedLibraries.length > 0) {
                    children.push(new IgnisJavaTreeItem(
                        'Referenced Libraries',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        NodeType.ReferencedLibraryContainer,
                        dirPath,
                        libs.referencedLibraries
                    ));
                }
            }
        }

        return children;
    }
}

// ==========================================
// 3. Complexity Explorer Sideview
// ==========================================

interface ComplexityItem {
    name: string;
    complexity: number;
    startLine: number; // 1-indexed
    endLine: number;   // 1-indexed
    uri: string;
    className: string;
}

class IgnisJavaComplexityTreeDataProvider implements vscode.TreeDataProvider<ComplexityItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ComplexityItem | undefined | null | void> = new vscode.EventEmitter<ComplexityItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<ComplexityItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private items: ComplexityItem[] = [];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ComplexityItem): vscode.TreeItem {
        const config = vscode.workspace.getConfiguration('ignis.java.complexity');
        const criticalThreshold = config.get<number>('criticalThreshold', 20);
        const isCritical = element.complexity >= criticalThreshold;

        const treeItem = new vscode.TreeItem(
            `${element.className}.${element.name}`,
            vscode.TreeItemCollapsibleState.None
        );

        treeItem.description = `Complexity: ${element.complexity}`;
        
        if (isCritical) {
            treeItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('problems.errorIcon.foreground'));
            treeItem.tooltip = `🔴 Critical Complexity: ${element.complexity}\nMethod: ${element.className}.${element.name}\nFile: ${vscode.Uri.parse(element.uri).fsPath}\nLine: ${element.startLine}`;
        } else {
            treeItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problems.warningIcon.foreground'));
            treeItem.tooltip = `🟡 High Complexity: ${element.complexity}\nMethod: ${element.className}.${element.name}\nFile: ${vscode.Uri.parse(element.uri).fsPath}\nLine: ${element.startLine}`;
        }

        treeItem.command = {
            command: 'ignis.java.complexity.goto',
            title: 'Go to Method',
            arguments: [element]
        };

        return treeItem;
    }

    async getChildren(element?: ComplexityItem): Promise<ComplexityItem[]> {
        if (element) {
            return [];
        }

        if (!jdtlsReady) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('ignis.java.complexity');
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
            return [];
        }

        const highThreshold = config.get<number>('highThreshold', 10);

        try {
            const results = await vscode.commands.executeCommand<ComplexityItem[]>(
                'java.execute.workspaceCommand',
                'ignis.java.complexity.scanWorkspace',
                highThreshold
            );

            this.items = results || [];
            return this.items;
        } catch (error) {
            console.error('Error scanning workspace complexity:', error);
            return [];
        }
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Ignis Arc Java IDE Extension Pack is active!');

    // Set custom context to show the sidebar icon only in Java projects
    vscode.commands.executeCommand('setContext', 'ignisJava:isJavaProject', true);

    // 1. Register TreeView & Code Lens Providers immediately
    const treeDataProvider = new IgnisJavaProjectTreeDataProvider();
    const treeView = vscode.window.createTreeView('ignisJavaProjectNavigator', {
        treeDataProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);

    const complexityDataProvider = new IgnisJavaComplexityTreeDataProvider();
    const complexityView = vscode.window.createTreeView('ignisJavaComplexityAnalyzer', {
        treeDataProvider: complexityDataProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(complexityView);

    registerComplexityLens(context);

    // 2. Wait for Red Hat Java extension (JDT LS) to fully initialize
    const javaExtension = vscode.extensions.getExtension('redhat.java');
    if (javaExtension) {
        if (!javaExtension.isActive) {
            await javaExtension.activate();
        }

        const api = javaExtension.exports;
        if (api) {
            // Await the standard server ready promise
            if (typeof api.serverReady === 'function') {
                api.serverReady().then(() => {
                    console.log('Java Language Server is fully ready! Enabling Ignis Arc Explorer...');
                    jdtlsReady = true;
                    // Trigger refresh on both Code Lenses, Explorer, and Complexity tree views
                    treeDataProvider.clearCache();
                    treeDataProvider.refresh();
                    complexityDataProvider.refresh();

                    // Automatically schedule retries in case projects are still importing in the background
                    setTimeout(() => {
                        console.log('Auto-refreshing Ignis Arc Explorer & Complexity sideview (2s delay)...');
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
                        complexityDataProvider.refresh();
                    }, 2000);

                    setTimeout(() => {
                        console.log('Auto-refreshing Ignis Arc Explorer & Complexity sideview (5s delay)...');
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
                        complexityDataProvider.refresh();
                    }, 5000);

                    setTimeout(() => {
                        console.log('Auto-refreshing Ignis Arc Explorer & Complexity sideview (10s delay)...');
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
                        complexityDataProvider.refresh();
                    }, 10000);
                });
            } else {
                jdtlsReady = true;
            }

            // Bind to JDT LS lifecycle events for dynamic auto-refreshing
            if (api.onDidProjectsImport) {
                context.subscriptions.push(
                    api.onDidProjectsImport(() => {
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
                        complexityDataProvider.refresh();
                    })
                );
            }
            if (api.onDidClasspathUpdate) {
                context.subscriptions.push(
                    api.onDidClasspathUpdate(() => {
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
                        complexityDataProvider.refresh();
                    })
                );
            }
        } else {
            jdtlsReady = true;
        }
    } else {
        jdtlsReady = true;
    }

    // 3. Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('ignis.java.navigator.refresh', () => {
            treeDataProvider.clearCache();
            treeDataProvider.refresh();
        }),
        vscode.commands.registerCommand('ignis.java.navigator.openFile', (uriStr: string) => {
            if (uriStr) {
                const uri = uriStr.startsWith('jdt:') ? vscode.Uri.parse(uriStr) : vscode.Uri.file(uriStr);
                vscode.workspace.openTextDocument(uri).then(
                    (doc) => {
                        vscode.window.showTextDocument(doc);
                    },
                    (err) => {
                        vscode.window.showErrorMessage(`Failed to open Java file: ${err}`);
                    }
                );
            }
        }),
        vscode.commands.registerCommand('ignis.java.complexity.refresh', () => {
            complexityDataProvider.refresh();
        }),
        vscode.commands.registerCommand('ignis.java.complexity.goto', (item: ComplexityItem) => {
            if (item && item.uri) {
                const uri = vscode.Uri.parse(item.uri);
                vscode.workspace.openTextDocument(uri).then(
                    (doc) => {
                        vscode.window.showTextDocument(doc).then((editor) => {
                            const line = Math.max(0, item.startLine - 1);
                            const pos = new vscode.Position(line, 0);
                            const endPos = new vscode.Position(line, doc.lineAt(line).text.length);
                            editor.selection = new vscode.Selection(pos, endPos);
                            editor.revealRange(new vscode.Range(pos, endPos), vscode.TextEditorRevealType.InCenter);
                        });
                    },
                    (err) => {
                        vscode.window.showErrorMessage(`Failed to open Java file: ${err}`);
                    }
                );
            }
        })
    );

    // 4. Hook up document save events to automatically refresh the complexity sideview on local saves
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'java' || document.fileName.endsWith('.java')) {
                complexityDataProvider.refresh();
            }
        })
    );
}

export function deactivate() {}

