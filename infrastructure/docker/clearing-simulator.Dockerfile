# clearing-simulator image (test/demo stand-in for the external clearing network - never deploy to production).
FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY backend/pom.xml backend/pom.xml
COPY backend/platform-service/pom.xml backend/platform-service/pom.xml
COPY backend/clearing-simulator/pom.xml backend/clearing-simulator/pom.xml
RUN mvn -B -q -f backend/pom.xml -pl clearing-simulator -am dependency:go-offline
COPY backend backend
RUN mvn -B -q -f backend/pom.xml -pl clearing-simulator -DskipTests package

FROM eclipse-temurin:21.0.5_11-jre-alpine
RUN addgroup -S app && adduser -S -G app -H -s /sbin/nologin app
WORKDIR /app
COPY --from=build /workspace/backend/clearing-simulator/target/clearing-simulator-1.0.0.jar app.jar
USER app:app
EXPOSE 8080
ENV SERVER_PORT=8080 JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:+ExitOnOutOfMemoryError"
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://localhost:${SERVER_PORT}/actuator/health/liveness" | grep -q '"status":"UP"' || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
