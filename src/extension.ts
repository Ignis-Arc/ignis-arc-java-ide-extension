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

    // Register Code Lens Provider
    const docSelector: vscode.DocumentSelector = { scheme: 'file', language: 'java' };
    const codeLensProvider = new JavaComplexityCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(docSelector, codeLensProvider)
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
            const javaExtension = vscode.extensions.getExtension('redhat.java');
            if (javaExtension && javaExtension.isActive) {
                const api = javaExtension.exports;
                if (api && typeof api.getClasspaths === 'function') {
                    const projectUri = vscode.Uri.file(projectPath).toString();
                    const classpathResult = await api.getClasspaths(projectUri, { scope: 'test' });
                    if (classpathResult) {
                        const classpaths = classpathResult.classpaths || [];
                        const modulepaths = classpathResult.modulepaths || [];
                        const allPaths = [...classpaths, ...modulepaths];

                        const systemLibraries: any[] = [];
                        const referencedLibraries: any[] = [];

                        const isSystemJar = (jarPath: string): boolean => {
                            const lower = jarPath.toLowerCase();
                            return lower.includes('jre') || 
                                   lower.includes('jdk') || 
                                   lower.includes('java-') || 
                                   lower.includes('rt.jar') || 
                                   lower.includes('jrt-fs') || 
                                   lower.includes('/jvm/') || 
                                   lower.includes('/jdk/') || 
                                   lower.includes('/jre/');
                        };

                        for (const p of allPaths) {
                            if (p.endsWith('.jar')) {
                                const name = path.basename(p);
                                const libNode = {
                                    name: name,
                                    path: p,
                                    id: p // Use absolute file path as handle ID
                                };
                                if (isSystemJar(p)) {
                                    systemLibraries.push(libNode);
                                } else {
                                    referencedLibraries.push(libNode);
                                }
                            }
                        }

                        // Avoid caching empty lists while JDT LS is still loading/importing
                        if (systemLibraries.length === 0 && referencedLibraries.length === 0) {
                            return null;
                        }

                        let jreName = 'JDK System Library';
                        const firstSystem = systemLibraries.find(lib => lib.path);
                        if (firstSystem) {
                            const parts = firstSystem.path.split(path.sep);
                            const jvmIdx = parts.findIndex((part: string) => part.includes('jvm') || part.includes('java-') || part.includes('jdk') || part.includes('jre'));
                            if (jvmIdx !== -1 && jvmIdx + 1 < parts.length) {
                                jreName = `JDK System Library [${parts[jvmIdx + 1]}]`;
                            }
                        }

                        const libs = {
                            jreName: jreName,
                            systemLibraries: systemLibraries,
                            referencedLibraries: referencedLibraries
                        };

                        this.projectLibrariesCache.set(projectPath, libs);
                        return libs;
                    }
                }
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
                    // Trigger refresh on both Code Lenses and Explorer tree view
                    treeDataProvider.clearCache();
                    treeDataProvider.refresh();

                    // Automatically schedule retries in case projects are still importing in the background
                    setTimeout(() => {
                        console.log('Auto-refreshing Ignis Arc Explorer (2s delay)...');
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
                    }, 2000);

                    setTimeout(() => {
                        console.log('Auto-refreshing Ignis Arc Explorer (5s delay)...');
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
                    }, 5000);

                    setTimeout(() => {
                        console.log('Auto-refreshing Ignis Arc Explorer (10s delay)...');
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
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
                    })
                );
            }
            if (api.onDidClasspathUpdate) {
                context.subscriptions.push(
                    api.onDidClasspathUpdate(() => {
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
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
        })
    );
}

export function deactivate() {}

