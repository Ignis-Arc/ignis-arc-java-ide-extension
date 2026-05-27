#!/bin/bash
# Exit on any error
set -e

echo "========================================="
echo "Building Ignis Arc Java IDE Backend..."
echo "========================================="

# Work inside the server-project directory
cd "$(dirname "$0")/server-project"

# Ensure clean directories
rm -rf bin
mkdir -p bin
mkdir -p ../server

# Locate local JDT LS plugins
JDTLS_PLUGINS_DIR="lib"
if [ ! -d "$JDTLS_PLUGINS_DIR" ]; then
    echo "Error: JDT LS plugins directory not found at $JDTLS_PLUGINS_DIR"
    exit 1
fi

# Create classpath from all jars in the plugins directory
CLASSPATH=""
for jar in "$JDTLS_PLUGINS_DIR"/*.jar; do
    CLASSPATH="$CLASSPATH:$jar"
done

echo "Compiling Java sources via ECJ..."
/usr/lib/jvm/java-21-openjdk-amd64/bin/java -jar lib/org.eclipse.jdt.core.compiler.batch_*.jar -cp "$CLASSPATH" -d bin src/com/ignis/arc/java/ide/IgnisSuiteCommandHandler.java

echo "Copying configuration files..."
cp plugin.xml bin/
mkdir -p bin/META-INF
cp META-INF/MANIFEST.MF bin/META-INF/

echo "Packaging OSGi bundle jar via zip..."
cd bin
zip -r ../../server/ignis-java-suite-backend.jar . > /dev/null
cd ..

echo "========================================="
echo "Success: Built Java backend at server/ignis-java-suite-backend.jar"
echo "========================================="
