# platform-service image. Build context: repository root.
#   docker build -f infrastructure/docker/platform-service.Dockerfile -t platform-service:1.0.0 .
# Pin base images by DIGEST in CI (docker buildx imagetools inspect <tag>) and let Dependabot/Renovate bump them.
# (The Spring Boot jar is built with layers enabled; switch to `java -Djarmode=tools -jar ... extract --layers` for
#  finer-grained image layer caching once the image size/pull time matters.)

FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace
# dependency layer first: only re-resolved when a pom changes
COPY backend/pom.xml backend/pom.xml
COPY backend/platform-service/pom.xml backend/platform-service/pom.xml
COPY backend/clearing-simulator/pom.xml backend/clearing-simulator/pom.xml
RUN mvn -B -q -f backend/pom.xml -pl platform-service -am dependency:go-offline
COPY backend backend
# tests run in CI before images are built; the image build only packages
RUN mvn -B -q -f backend/pom.xml -pl platform-service -DskipTests package

FROM eclipse-temurin:21.0.5_11-jre-alpine
# non-root, no login shell
RUN addgroup -S app && adduser -S -G app -H -s /sbin/nologin app
WORKDIR /app
COPY --from=build /workspace/backend/platform-service/target/platform-service-1.0.0.jar app.jar
USER app:app
EXPOSE 8080 9090
ENV SERVER_PORT=8080 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseG1GC -XX:+ExitOnOutOfMemoryError -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp -Djava.security.egd=file:/dev/./urandom"
# graceful shutdown: SIGTERM -> Spring stops accepting requests and drains in-flight work for up to 20 s
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- "http://localhost:${SERVER_PORT}/actuator/health/liveness" | grep -q '"status":"UP"' || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
