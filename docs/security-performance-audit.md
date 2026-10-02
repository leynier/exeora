# Reporte de auditoría de seguridad y rendimiento

Fecha: 2 de octubre de 2026. Plataforma: Exeora. Base revisada: `1594894`. Estado: mejoras locales, sin despliegue ni publicación, conforme a la última instrucción del usuario.

## Resultado y alcance

Se revisaron el gateway de Cloudflare, OAuth y sesiones, MCP y Durable Objects, D1/KV y archivo de auditoría, máquinas cloud, integraciones con GitHub y proveedores de IA, CLI nativo, dashboard, extensión de Chrome, protocolo compartido, instaladores y workflows de mantenimiento y release. Se conservaron las correcciones que ya estaban en este workspace y se añadieron reparaciones tras la revisión por componente.

La auditoría combina inspección del código, reproducciones y regresiones automatizadas, compilaciones de producción, análisis de dependencias y comprobaciones de credenciales en el código. Las pruebas del gateway usan workerd, D1 y Durable Objects reales en el entorno local. No se ejecutaron herramientas sobre máquinas de clientes ni generaciones externas de IA. Las consultas públicas de producción fueron GET de referencia; no prueban que estas correcciones estén activas en producción.

## 1. Mejoras de seguridad implementadas

| Área | Corrección | Beneficio |
|---|---|---|
| OAuth y sesiones | Origen de callback configurado, conservación de la vinculación al navegador/recurso y controles sobre scopes y consentimiento. | Reduce la posibilidad de combinar permisos o desviar el flujo de autenticación. |
| Cuerpos HTTP | Límites sobre los bytes realmente consumidos: 64 KiB en OAuth, 16 MiB en API y 25 MiB en el webhook GitHub, aunque falte `Content-Length` o el cuerpo llegue por partes. | Acota memoria y trabajo antes de interpretar JSON o formularios. |
| Listas de acceso y SQL | Límites de entrada y consultas por lotes por debajo del máximo de parámetros de D1. | Evita errores internos y consultas desproporcionadas con listas grandes. |
| Respuestas y navegador | `no-store` en rutas sensibles, `nosniff`, HSTS en HTTPS, política de referencias y CSP específica para dashboard, OAuth y panel. | Protege tokens y respuestas de cachés; limita scripts y quién puede embeber cada página. |
| MCP y relay | Nueva comprobación del catálogo del ejecutor al despachar, incluidos sus indicadores de lectura y modificación. | Evita decidir autorizaciones con un catálogo anterior a una reconexión o actualización. |
| GitHub | Redirecciones con credenciales bloqueadas, identificadores validados y respuestas incompletas rechazadas. | Evita transmitir tokens a destinos inesperados o revocar enlaces por interpretar un fallo del proveedor como una lista vacía. |
| Cloud | Reconciliación conservadora si no se conoce la antigüedad de una máquina, URL validada antes de enviar el token y salida de comandos Sprites limitada a 4 MiB. | Reduce el riesgo de eliminar máquinas activas, exponer tokens o retener datos sin límite. |
| Respuestas de IA | Límite de 200.000 caracteres de salida en JSON y streaming; cancelación cuando se supera. | Acota las respuestas retenidas y detecta resultados excesivos. |
| Archivo de auditoría | Identificadores SQL validados, timeout de 15 segundos en R2 SQL, errores de proveedor acotados y mantenimiento de tablas actual y heredada. | Protege consultas y evita dejar la tabla nueva fuera del mantenimiento. |
| Dashboard y panel | Validación de URLs externas, destinos de retorno y tickets WebSocket del mismo origen, y control de respuestas asíncronas de autenticación. | Evita destinos inseguros, envío de tickets a otros hosts y resultados de login que llegan después de cerrar o cambiar el flujo. |
| CLI | Archivos privados y tokens endurecidos, validación del gateway, controles de credenciales Git, políticas, límites de procesos y limpieza de hijos/cancelaciones. | Reduce exposición de secretos y recursos que quedan ejecutándose después de terminar una operación. |
| Instalación y upgrade | Directorios temporales exclusivos, validación de versión, checksum único y verificación antes de reemplazar el ejecutable. | Impide instalar descargas corruptas y limita interferencias en archivos temporales. |
| Releases y despliegues futuros | CI sobre el commit seleccionado, secretos validados antes de migrar D1, acciones fijadas a commits y publicación del crate después de todos los builds nativos. | Evita migrar/publicar antes de descubrir fallos de validación o de una plataforma. |

Los cambios de los workflows permanecen en el workspace: no se activó ningún despliegue, release ni automatización remota nueva.

Puntos de entrada para revisar la implementación: [límites HTTP](../apps/gateway/src/request-body.ts), [cabeceras y CSP](../apps/gateway/src/gateway-response.ts), [despacho MCP](../apps/gateway/src/dispatch-mcp.ts), [acceso OAuth por lotes](../apps/gateway/src/oauth/target.ts), [integración Sprites](../apps/gateway/src/cloud/sprites.ts), [credenciales privadas del CLI](../crates/exeora-cli/src/private.rs), [procesos del CLI](../crates/exeora-cli/src/tools/processes.rs), [tickets WebSocket](../apps/web/dashboard/src/socket-url.ts) y [workflow de despliegue preparado](../.github/workflows/deploy.yml).

## 2. Dependencias

El lockfile JavaScript anterior presenta 40 avisos únicos en 11 paquetes: 15 altos, 21 moderados y 4 bajos. Son 50 registros cuando se cuentan las distintas versiones afectadas por un mismo aviso. El lockfile actualizado devuelve cero avisos con `bun audit --json`, también usando Bun 1.3.14, la versión de CI. Entre las actualizaciones y overrides están Hono y dependencias transitivas de herramientas de desarrollo/build. Estos conteos no significan que todos los avisos fueran explotables en el Worker de producción.

RustSec detectó `rustls` 0.23.43 afectado por [RUSTSEC-2026-0285](https://github.com/rustls/rustls/security/advisories/GHSA-2mjx-qc3c-rqvc) y una versión retirada de `chacha20`. El lockfile corregido usa `rustls` 0.23.45, `rustls-webpki` 0.103.15 y `chacha20` 0.10.2. `cargo-audit` 0.22.2 revisa 476 dependencias contra 1.279 avisos y termina con cero vulnerabilidades y cero advertencias.

Se preparó un workflow de auditoría de dependencias para PR con cambios relevantes, ejecución manual y comprobación nocturna. Su activación queda pendiente de integrar los cambios. La base de avisos cambia con el tiempo; el resultado anterior corresponde a esta revisión.

La exploración de código con Gitleaks, con valores redactados y sin incluir secretos locales ignorados por Git ni builds/dependencias generados, produjo 14 coincidencias. La inspección identifica fixtures, claves deliberadamente inválidas de tests y el identificador público OAuth de xAI; no se confirmó una credencial de producción entre ellas. Esto no equivale a una revisión completa de secretos históricos o del vault.

## 3. Mejoras de rendimiento

1. **Carga bajo demanda:** editor, terminal, previsualización Markdown y paneles de detalles se separan del chunk de entrada de Workspace. Ese archivo pasa de **1.059,33 kB / 318,52 kB gzip** a **39,12 kB / 13,27 kB gzip**. La comparación corresponde a ese archivo; la página también utiliza chunks compartidos y descarga los módulos de cada función cuando se necesitan.
2. **Caché de assets:** archivos con hash de dashboard/Astro reciben `max-age=31536000, immutable`. El HTML sigue revalidándose para descubrir los archivos de cada versión, y las respuestas autenticadas se mantienen sin caché.
3. **Lectura de MCP acotada:** inspección del handshake limitada a 64 KiB y omisión de una lectura adicional cuando ya se sabe que la petición no es `initialize`.
4. **Trabajo por lotes:** agrupación de consultas de proyectos/ubicaciones en lotes de 80 IDs y fan-out de relay acotado a 16 operaciones pendientes, conservando los filtros de propietario y los controles de autorización. Las selecciones de acceso admiten hasta 500 proyectos mediante consultas y escrituras por lotes.
5. **Menos llamadas redundantes:** comprobaciones frescas de acceso a un repositorio compartidas dentro de una operación cuando varios proyectos apuntan al mismo repositorio; el estado no se comparte entre usuarios u operaciones.
6. **Recursos y polling:** límites de procesos/salida, cancelación y prevención de solicitudes de autenticación simultáneas o repetidas.
7. **Índice de reconciliación GitHub:** se añadió `github_repositories_installation` y la migración aditiva `0026_github_repository_installation_index.sql`. Una prueba real de D1 compara `EXPLAIN QUERY PLAN`: la consulta pasa de `SCAN github_repositories` a `SEARCH ... USING INDEX github_repositories_installation`. La migración solo se aplica en la base aislada de tests; su aplicación a producción queda pendiente.

Las métricas de tamaño y número de operaciones permiten verificar estas mejoras. No se realizó una prueba de carga sobre producción ni se afirma una reducción porcentual de latencia global: depende también de ejecutores y proveedores externos.

## 4. Validación

| Comprobación | Resultado observado |
|---|---|
| Suite JavaScript/TypeScript completa | 149 archivos y 1.478 tests correctos, incluidos gateway/workerd, D1, protocolo, dashboard y extensión. |
| Navegador Chromium E2E | 136/136 escenarios correctos. |
| Dashboard y extensión | 65 tests de dashboard y 23 de extensión correctos; builds web/extension y tipos pasan. Estos tests unitarios forman parte de la suite completa. |
| Contratos y calidad | Generación Rust del protocolo sin cambios de contrato; Biome, límites de longitud de archivos, TypeScript, metadatos Drizzle y `git diff --check` correctos. |
| Dependencias | Bun 1.3.14 y cargo-audit 0.22.2: cero avisos en los lockfiles corregidos. |
| Mantenimiento y release | 15 tests de mantenimiento correctos; YAML, sintaxis shell, instaladores/bootstrap y casos de validación de secretos comprobados. |
| Rust en Linux | 360 tests del CLI correctos: 298 unitarios y 62 de integración/contrato. Pasan `cargo test --locked --workspace`, `cargo clippy --locked --workspace --all-targets -- -D warnings` y `cargo fmt --all -- --check`. También pasa el CLI con `--all-targets`. |
| Benchmarks Rust | `cargo bench --locked --workspace --no-run` correcto: cuatro ejecutables compilados. No se ejecutó una comparación de rendimiento contra una versión anterior. |
| Windows x86_64 MSVC | Rust/Cargo 1.98 y PowerShell 5.1: `cargo check --workspace` correcto y `cargo check --locked -p exeora-cli --all-targets` correcto con el snapshot final, sin warnings; parseo de `install.ps1` y pruebas de detección de arquitectura correctos. La suite Rust de Windows se interrumpió durante el enlace prolongado; no se considera validada. |
| macOS ARM64 | Rust/Cargo 1.98: `cargo check --locked -p exeora-cli --all-targets` correcto con el snapshot final. No se ejecutó la suite Rust completa en macOS ni el target Intel. |

Las comprobaciones anteriores se ejecutaron localmente o en espejos de build aislados. Los procesos temporales de pruebas/build se cerraron; el staging temporal macOS se eliminó y se conservaron los caches y recursos preexistentes.

## 5. Límites y estado de entrega

- Los cambios no están desplegados ni publicados. No hubo push, merge, tags, publicación de paquetes, migraciones remotas ni escrituras de producción.
- El CLI conserva la versión 0.20.0; se retiró el incremento de versión preparado para un release que ya no se realizará en este trabajo.
- La ejecución de comandos conserva los permisos del usuario del sistema operativo. La confinación de archivos y la política de comandos no constituyen un sandbox del sistema operativo.
- Los controles de propietario y permisos de archivos privados son POSIX; Windows depende de sus ACL nativas. Los process groups y Job Objects mejoran la limpieza de procesos, aunque un descendiente que se desacople deliberadamente puede sobrevivir.
- GitHub, Cloudflare, Fly y los proveedores de IA siguen siendo dependencias externas. Los logins de suscripciones de IA no oficiales pueden cambiar sin aviso.
- El cron cloud inspecciona la flota completa. Una optimización incremental debe evaluarse con métricas de una flota grande, conservando la detección de máquinas huérfanas y las reglas de eliminación.
- Las reglas de aprobación de entornos y protección de ramas son configuración remota; no se modificaron. El workflow administrado de Pullfrog conserva sus referencias flotantes según su instrucción de no editarlo.
- El reporte distingue validación local, revisión de código y estado de producción; no constituye una garantía de ausencia absoluta de vulnerabilidades.
