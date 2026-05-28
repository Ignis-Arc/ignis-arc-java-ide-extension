package com.ignis.arc.java.ide;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.eclipse.core.resources.IProject;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.dom.*;
import org.eclipse.jdt.ls.core.internal.IDelegateCommandHandler;
import org.eclipse.jdt.ls.core.internal.JDTUtils;

public class IgnisSuiteCommandHandler implements IDelegateCommandHandler {

    @Override
    public Object executeCommand(String commandId, List<Object> arguments, IProgressMonitor monitor) throws Exception {
        if ("ignis.java.complexity.calculate".equals(commandId)) {
            return calculateComplexity(arguments, monitor);
        } else if ("ignis.java.project.getStructure".equals(commandId)) {
            return getProjectStructure(monitor);
        } else if ("ignis.java.project.getLibraries".equals(commandId)) {
            return getProjectLibraries(arguments);
        } else if ("ignis.java.library.getPackages".equals(commandId)) {
            return getLibraryPackages(arguments);
        } else if ("ignis.java.library.getClasses".equals(commandId)) {
            return getLibraryClasses(arguments);
        } else if ("ignis.java.complexity.scanWorkspace".equals(commandId)) {
            return scanWorkspaceComplexity(arguments, monitor);
        }
        throw new UnsupportedOperationException("Unsupported command: " + commandId);
    }

    private Object calculateComplexity(List<Object> arguments, IProgressMonitor monitor) throws Exception {
        if (arguments == null || arguments.isEmpty()) {
            return null;
        }
        String fileUri = (String) arguments.get(0);
        ICompilationUnit compilationUnit = JDTUtils.resolveCompilationUnit(fileUri);
        if (compilationUnit == null) {
            return null;
        }

        ASTParser parser = ASTParser.newParser(AST.JLS17);
        parser.setSource(compilationUnit);
        parser.setResolveBindings(false);
        CompilationUnit astRoot = (CompilationUnit) parser.createAST(monitor);

        List<Map<String, Object>> methodsMetrics = new ArrayList<>();

        astRoot.accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodDeclaration node) {
                if (node.getBody() == null) {
                    return true;
                }

                // Filter out synthesized/Lombok-generated methods
                if (node.getBody().getStartPosition() <= node.getName().getStartPosition()) {
                    return true;
                }

                int complexity = calculateCyclomaticComplexity(node);

                Map<String, Object> metric = new HashMap<>();
                metric.put("name", node.getName().getIdentifier());
                metric.put("complexity", complexity);
                metric.put("startLine", astRoot.getLineNumber(node.getName().getStartPosition()));
                metric.put("endLine", astRoot.getLineNumber(node.getStartPosition() + node.getLength()));

                methodsMetrics.add(metric);
                return true;
            }
        });

        return methodsMetrics;
    }

    private int calculateCyclomaticComplexity(MethodDeclaration method) {
        final int[] count = { 1 };
        method.getBody().accept(new ASTVisitor() {
            @Override
            public boolean visit(IfStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(ForStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(EnhancedForStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(WhileStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(DoStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(CatchClause node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(SwitchCase node) {
                if (!node.isDefault()) {
                    count[0]++;
                }
                return true;
            }
            @Override
            public boolean visit(InfixExpression node) {
                InfixExpression.Operator op = node.getOperator();
                if (op == InfixExpression.Operator.CONDITIONAL_AND || op == InfixExpression.Operator.CONDITIONAL_OR) {
                    count[0]++;
                }
                return true;
            }
            @Override
            public boolean visit(ConditionalExpression node) {
                count[0]++;
                return true;
            }
        });
        return count[0];
    }

    private Object getProjectStructure(IProgressMonitor monitor) throws Exception {
        List<Map<String, Object>> projectList = new ArrayList<>();

        IProject[] projects = ResourcesPlugin.getWorkspace().getRoot().getProjects();
        for (IProject project : projects) {
            if (!project.isOpen() || !project.hasNature(JavaCore.NATURE_ID)) {
                continue;
            }

            Map<String, Object> projectMap = new HashMap<>();
            projectMap.put("name", project.getName());
            
            String projectPath = project.getLocation() != null ? project.getLocation().toOSString() : "";
            projectMap.put("path", projectPath);

            String type = "standard";
            if (new File(projectPath, "pom.xml").exists()) {
                type = "maven";
            } else if (new File(projectPath, "build.gradle").exists() || new File(projectPath, "build.gradle.kts").exists()) {
                type = "gradle";
            }
            projectMap.put("type", type);
            projectList.add(projectMap);
        }

        return projectList;
    }

    private Object getProjectLibraries(List<Object> arguments) throws Exception {
        Map<String, Object> result = new HashMap<>();
        List<Map<String, Object>> systemLibs = new ArrayList<>();
        List<Map<String, Object>> userLibs = new ArrayList<>();
        String jreName = "JDK System Library";

        try {
            IJavaModel javaModel = JavaCore.create(ResourcesPlugin.getWorkspace().getRoot());
            IJavaProject[] javaProjects = javaModel.getJavaProjects();

            for (IJavaProject javaProject : javaProjects) {
                // Try to find JRE description from JDT container
                if ("JDK System Library".equals(jreName)) {
                    try {
                        for (IClasspathEntry entry : javaProject.getRawClasspath()) {
                            if (entry.getEntryKind() == IClasspathEntry.CPE_CONTAINER) {
                                if (entry.getPath().toString().contains("org.eclipse.jdt.launching.JRE_CONTAINER")) {
                                    IClasspathContainer container = JavaCore.getClasspathContainer(entry.getPath(), javaProject);
                                    if (container != null) {
                                        jreName = container.getDescription();
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (Exception e) {
                        // ignore
                    }
                }

                try {
                    IPackageFragmentRoot[] roots = javaProject.getPackageFragmentRoots();
                    for (IPackageFragmentRoot root : roots) {
                        if (root.getKind() == IPackageFragmentRoot.K_BINARY) {
                            String rootPath = root.getPath().toOSString();
                            Map<String, Object> libMap = new HashMap<>();
                            libMap.put("name", root.getElementName());
                            libMap.put("path", rootPath);
                            libMap.put("id", root.getHandleIdentifier());

                            // Classify: JDK/JRE system library vs user referenced library
                            boolean isSystem = false;
                            IClasspathEntry rawEntry = root.getRawClasspathEntry();
                            if (rawEntry != null && rawEntry.getEntryKind() == IClasspathEntry.CPE_CONTAINER) {
                                if (rawEntry.getPath().toString().contains("org.eclipse.jdt.launching.JRE_CONTAINER")) {
                                    isSystem = true;
                                }
                            }

                            if (isSystem) {
                                if (!containsPath(systemLibs, rootPath)) {
                                    systemLibs.add(libMap);
                                }
                            } else {
                                if (!containsPath(userLibs, rootPath)) {
                                    userLibs.add(libMap);
                                }
                            }
                        }
                    }
                } catch (Exception e) {
                    // ignore
                }
            }
        } catch (Exception e) {
            // ignore
        }

        result.put("jreName", jreName);
        result.put("systemLibraries", systemLibs);
        result.put("referencedLibraries", userLibs);
        return result;
    }

    private boolean containsPath(List<Map<String, Object>> list, String path) {
        for (Map<String, Object> map : list) {
            if (path.equals(map.get("path"))) {
                return true;
            }
        }
        return false;
    }

    private Object getLibraryPackages(List<Object> arguments) throws Exception {
        if (arguments == null || arguments.isEmpty()) {
            return null;
        }
        String handleId = (String) arguments.get(0);
        IPackageFragmentRoot root = null;
        
        if (handleId.startsWith("=") || handleId.startsWith("[")) {
            root = (IPackageFragmentRoot) JavaCore.create(handleId);
        } else {
            // It's an absolute path!
            org.eclipse.core.runtime.IPath path = org.eclipse.core.runtime.Path.fromOSString(handleId);
            for (IProject project : ResourcesPlugin.getWorkspace().getRoot().getProjects()) {
                if (project.isOpen() && project.hasNature(JavaCore.NATURE_ID)) {
                    IJavaProject javaProject = JavaCore.create(project);
                    root = javaProject.findPackageFragmentRoot(path);
                    if (root != null && root.exists()) {
                        break;
                    }
                }
            }
        }

        if (root == null || !root.exists()) {
            return null;
        }

        List<Map<String, Object>> packagesList = new ArrayList<>();
        for (IJavaElement child : root.getChildren()) {
            if (child instanceof IPackageFragment) {
                IPackageFragment pkg = (IPackageFragment) child;
                if (pkg.hasChildren()) {
                    Map<String, Object> pkgMap = new HashMap<>();
                    pkgMap.put("name", pkg.getElementName());
                    pkgMap.put("id", pkg.getHandleIdentifier());
                    packagesList.add(pkgMap);
                }
            }
        }
        return packagesList;
    }

    private Object getLibraryClasses(List<Object> arguments) throws Exception {
        if (arguments == null || arguments.isEmpty()) {
            return null;
        }
        String handleId = (String) arguments.get(0);
        IPackageFragment pkg = (IPackageFragment) JavaCore.create(handleId);
        if (pkg == null || !pkg.exists()) {
            return null;
        }

        List<Map<String, Object>> classesList = new ArrayList<>();
        for (IJavaElement child : pkg.getChildren()) {
            if (child instanceof IClassFile) {
                IClassFile classFile = (IClassFile) child;
                Map<String, Object> classMap = new HashMap<>();
                classMap.put("name", classFile.getElementName());
                classMap.put("id", classFile.getHandleIdentifier());
                classMap.put("uri", JDTUtils.toUri(classFile));
                classesList.add(classMap);
            }
        }
        return classesList;
    }

    private Object scanWorkspaceComplexity(List<Object> arguments, IProgressMonitor monitor) throws Exception {
        int threshold = 10;
        if (arguments != null && !arguments.isEmpty()) {
            Object firstArg = arguments.get(0);
            if (firstArg instanceof Number) {
                threshold = ((Number) firstArg).intValue();
            } else if (firstArg instanceof String) {
                try {
                    threshold = Integer.parseInt((String) firstArg);
                } catch (NumberFormatException e) {
                    // ignore
                }
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        IJavaModel javaModel = JavaCore.create(ResourcesPlugin.getWorkspace().getRoot());
        IJavaProject[] javaProjects = javaModel.getJavaProjects();

        for (IJavaProject javaProject : javaProjects) {
            if (!javaProject.getProject().isOpen()) {
                continue;
            }
            IPackageFragmentRoot[] roots = javaProject.getPackageFragmentRoots();
            for (IPackageFragmentRoot root : roots) {
                if (root.getKind() == IPackageFragmentRoot.K_SOURCE) {
                    analyzePackageFragmentRootComplexity(root, threshold, result, monitor);
                }
            }
        }

        result.sort((a, b) -> {
            int compA = (Integer) a.get("complexity");
            int compB = (Integer) b.get("complexity");
            return Integer.compare(compB, compA);
        });

        return result;
    }

    private void analyzePackageFragmentRootComplexity(IPackageFragmentRoot root, int threshold, List<Map<String, Object>> result, IProgressMonitor monitor) throws Exception {
        for (IJavaElement child : root.getChildren()) {
            if (child instanceof IPackageFragment) {
                IPackageFragment pkg = (IPackageFragment) child;
                for (ICompilationUnit unit : pkg.getCompilationUnits()) {
                    analyzeUnitComplexity(unit, threshold, result, monitor);
                }
            }
        }
    }

    private void analyzeUnitComplexity(ICompilationUnit unit, int threshold, List<Map<String, Object>> result, IProgressMonitor monitor) throws Exception {
        ASTParser parser = ASTParser.newParser(AST.JLS17);
        parser.setSource(unit);
        parser.setResolveBindings(false);
        CompilationUnit astRoot = (CompilationUnit) parser.createAST(monitor);

        String fileUri = JDTUtils.toUri(unit);

        astRoot.accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodDeclaration node) {
                if (node.getBody() == null) {
                    return true;
                }

                // Filter out synthesized/Lombok-generated methods
                if (node.getBody().getStartPosition() <= node.getName().getStartPosition()) {
                    return true;
                }

                int complexity = calculateCyclomaticComplexity(node);
                if (complexity >= threshold) {
                    Map<String, Object> metric = new HashMap<>();
                    metric.put("name", node.getName().getIdentifier());
                    metric.put("complexity", complexity);
                    metric.put("startLine", astRoot.getLineNumber(node.getName().getStartPosition()));
                    metric.put("endLine", astRoot.getLineNumber(node.getStartPosition() + node.getLength()));
                    metric.put("uri", fileUri);

                    String className = "";
                    ASTNode parent = node.getParent();
                    while (parent != null) {
                        if (parent instanceof TypeDeclaration) {
                            className = ((TypeDeclaration) parent).getName().getIdentifier();
                            break;
                        }
                        parent = parent.getParent();
                    }
                    metric.put("className", className);

                    result.add(metric);
                }
                return true;
            }
        });
    }
}
