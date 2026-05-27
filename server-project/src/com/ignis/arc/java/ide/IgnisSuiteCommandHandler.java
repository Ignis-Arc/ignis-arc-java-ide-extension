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

                int complexity = calculateCyclomaticComplexity(node);

                Map<String, Object> metric = new HashMap<>();
                metric.put("name", node.getName().getIdentifier());
                metric.put("complexity", complexity);
                metric.put("startLine", astRoot.getLineNumber(node.getStartPosition()));
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
                            String pathStr = rootPath.toLowerCase();
                            
                            // If it's a Maven or Gradle cache entry, it is NEVER a JDK system library!
                            if (pathStr.contains(".m2/repository") || 
                                pathStr.contains(".gradle/caches") || 
                                pathStr.contains("/.m2/") || 
                                pathStr.contains("/.gradle/")) {
                                isSystem = false;
                            } else if (pathStr.contains("jre") || 
                                       pathStr.contains("jdk") || 
                                       pathStr.contains("java-") || 
                                       pathStr.contains("rt.jar") || 
                                       pathStr.contains("jrt-fs") ||
                                       pathStr.contains("/jvm/") ||
                                       pathStr.contains("javavirtualmachines") ||
                                       pathStr.contains("\\program files\\java\\")) {
                                isSystem = true;
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
}
