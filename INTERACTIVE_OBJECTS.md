# Los 24 objetos interactivos de Social Rooms

Los modelos del ZIP están en `src/assets/interactive/`. Se conserva el salón, sus corredores, el editor, PostgreSQL, Socket.IO, voz, pantalla y los avatares existentes. Los objetos nuevos están en la colección gratuita del editor de cada dormitorio; no se añadieron automáticamente al salón ni se borraron habitaciones.

## Probar la aplicación

1. Entra con tu nombre, pulsa **Edit Room** y busca un objeto en la colección.
2. Colócalo en el suelo. Selecciónalo para moverlo, girarlo en pasos de 90°, escalarlo entre 0.5× y 2× o eliminarlo. **Save Room** conserva el diseño completo.
3. Para configurar un objeto nuevo, guarda primero el diseño y pulsa **Configurar / usar**. Las imágenes y configuraciones se guardan directamente desde su panel.
4. Sal de decoración. Acércate al objeto y pulsa **E**, haz clic en él o usa el botón contextual. En pantallas táctiles hay flechas para caminar y un botón contextual; la pizarra acepta el dedo.
5. Abre otra sesión con **un nombre distinto**, visita el dormitorio y prueba las interacciones compartidas. El visitante no puede editar ni configurar.
6. Coloca un póster, sube una foto, elige Mostrar completa o Rellenar, cambia recorte/marco y guarda. Recarga y entra con el mismo nombre. Comprueba también la foto desde la sesión visitante.
7. Prueba dos personas intentando ocupar el mismo sillón o trono. La segunda recibe un error. Levantarse o desconectarse libera el asiento.
8. Abre la pizarra en dos sesiones. Guarda un dibujo en una. La otra debe revisar y aceptar la nueva versión antes de guardar; conserva su dibujo pendiente.
9. Activa una reacción y espera unos segundos, pausa las reacciones visuales o cambia de habitación. Las partículas desaparecen, los muebles recuperan su transformación guardada y el audio de la habitación anterior se detiene.
10. Configura un portal a un dormitorio. Su propietario puede pulsar **Cerrar a nuevas visitas**: el portal debe rechazar la llegada. Cerrar bloquea nuevos accesos HTTP/Socket.IO y no expulsa las conexiones ya establecidas.

## Comportamiento de los objetos

| Modelo | Uso implementado | Configuración del propietario |
|---|---|---|
| 01 Diana perchero | Apuntar con ratón/dedo, tres dardos, puntuación calculada en Flask y resultado | Hasta tres piezas de la colección como accesorios en miniatura |
| 02 Radio retro | Reproducir/pausar y elegir pista; pista/posición/estado compartidos; activación y volumen locales | Subir hasta diez audios reproducibles y cambiar sus títulos |
| 03 Póster | Ver y ampliar la foto | Archivo o arrastrar, vista previa, proporción, recorte, color del marco, restaurar imagen inicial |
| 04 Marco de fotos | Flechas, ampliación y presentación compartida por tiempo | Hasta veinte fotos, ajuste, marco e intervalo de 2–60 segundos |
| 05 Pizarra | Lienzo táctil, color, tamaño, borrador, veinte pasos de deshacer, mensaje y autor | Borrar una capa concreta o limpiar todas; máximo diez aportaciones |
| 06 Libro de visitas | Dedicatorias con autor/fecha, páginas con transición breve | Eliminar entradas; máximo cien mensajes de 300 caracteres |
| 07 Snacks | Patatas, zumo o galleta virtual; entrega, objeto temporal en mano, consumir y reacción | No hay pagos ni recompensas permanentes |
| 08 Acuario | Peces con movimiento suave, tocar un pez para ver nombre, comida y acercamiento | Tres nombres, color e intensidad; alimentar cada ocho segundos |
| 09 Discoteca | Activar/desactivar fiesta, giro lento y luz moderada compartida | Color/intensidad; sin flashes |
| 10 Sillón mano | Asiento exclusivo y levantarse | Pose normal, relajada o saludando |
| 11 Alfombra | Pupilas siguen al avatar cercano; reacción al pisar; no bloquea movimiento | Color |
| 12 Espejo | Representación ligera del avatar; sombrero, gafas o color temporal | Efectos locales al cuarto, compartidos en el avatar; quitar o caducar a los dos minutos |
| 13 Puerta diminuta | Abre, aparece un pequeño personaje original y alterna tres saludos | Espera de cinco segundos |
| 14 NO TOCAR | Confeti, patitos o color de luz temporal, compartido | Nunca cambia el diseño permanente |
| 15 Ventana | Paisaje con movimiento discreto y sonido ambiental sintetizado opcional | Espacio, ciudad lluviosa, playa o mar; permiso ambiental y volumen local |
| 16 Portal | Comprueba destino, muestra nombre y confirma viaje | Elegir una habitación accesible; se vuelve a comprobar antes de viajar |
| 17 Vitrina | Tres espacios con miniaturas; ver nombre, descripción y procedencia | Selección y orden de piezas disponibles de la colección gratuita |
| 18 Caja | Tapa móvil, patitos/confeti o una pequeña mano temporal; vuelve a cerrarse | No modifica el inventario |
| 19 Lámpara cono | Encendido compartido, brillo y luz local sin sombras nuevas | Color/intensidad |
| 20 Trono | Asiento exclusivo y corona temporal sobre el avatar | Las mismas tres poses del sillón |
| 21 Patito | Compresión breve y sonido corto sintetizado cuando se activa audio | Color y escala; espera de dos segundos |
| 22 Planta | Pupilas siguen al avatar, saludo de hojas, gotas al regar | Sin mantenimiento obligatorio |
| 23 Tostadora | Alas separadas, levitación y tostada temporal compartida | Sin motor físico |
| 24 Cuadro torcido | Se endereza unos segundos y vuelve a su inclinación estable; ampliar foto | Mismo sistema de fotos, ajuste y marco del póster |

El minijuego de dardos usa anillos concéntricos sencillos (50/25/20/10/5/1), no reglas oficiales de competición. El espejo representa el avatar en un panel 3D; no calcula un reflejo óptico de toda la habitación. Las escenas de la ventana y los sonidos breves son procedurales. La radio reproduce archivos reales subidos: no hay Spotify, YouTube ni otro servicio musical conectado. La colección es gratuita y común a todos; no se inventó una economía ni un inventario de recompensas.

## Datos y flujo

Una instancia sigue siendo un registro pequeño:

```json
{
  "id": "uuid",
  "type": "poster",
  "position": [1.5, 0, -2],
  "rotation": 1.5707963267948966,
  "scale": 1.2,
  "config": {
    "images": ["/api/media/0123456789abcdef0123456789abcdef"],
    "fit": "cover",
    "crop": [0.5, 0.5],
    "frameColor": "#805c42"
  },
  "revision": 3
}
```

`position.y` continúa en cero, como en el editor original. No se añadió arrastre vertical, montaje automático en paredes ni apilado de objetos. `scale` es uniforme y cambia también las huellas de colisión y la altura de asiento. `state` guarda mensajes, dibujos, reproducción, interruptores y metadatos de reacciones; el cliente no puede escribirlo mediante PUT. Los registros antiguos sin escala/configuración siguen siendo válidos.

```text
Inicio → GET /api/rooms/id → registros PostgreSQL → React → GLB bajo demanda
Diseño → estado items → PUT /api/rooms/id → validar límites → guardar → aviso a visitantes
Foto → decodificar/orientar/reducir → multipart POST media → Pillow → archivo WebP + referencia DB
Configurar → PATCH objeto + revisión → comprobar propietario/archivo → commit → object_update
Usar → object_action Socket.IO → comprobar cuarto/distancia/acción/espera → bloqueo de fila → commit
     → object_update a los presentes → estado React → pequeña reacción visual
Asiento → player_sit → bloqueo de jugadores → comprobar ocupación → postura compartida
Salir → desmontar RoomEditor → listeners/temporizadores/audio/efectos liberados
```

No se guardan objetos Three.js ni imágenes en base64 en PostgreSQL. Las imágenes se limitan a 10 MB y 25 millones de píxeles al decodificar; se orientan por EXIF, se reducen a 2048 píxeles por lado y se convierten a WebP conservando alfa. Los formatos que el navegador decodifica se convierten antes de subir; HEIC/TIFF sin decodificador muestran un error claro. GIF/otras imágenes animadas se guardan como una imagen fija. Audio: hasta 20 MB; MP3/WAV/OGG/FLAC/M4A admitidos cuando el navegador puede reproducir su códec. El servidor comprueba firmas y el navegador comprueba decodificación; no se añadieron conversores de códecs de audio.

Los archivos viven en `backend/uploads/` (o `SOCIAL_ROOMS_UPLOAD_DIR`) y `media_assets` guarda identificador, habitación, propietario de subida, tipo y tamaño. Hay una cuota de 300 archivos / 150 MB por habitación. Los archivos de imágenes reemplazadas se conservan por ahora; no hay biblioteca ni recolector automático de archivos huérfanos. Haz copia de PostgreSQL **y de uploads** al trasladar el proyecto.

Las acciones tienen tiempos de espera en el servidor. Como máximo hay cuatro reacciones con partículas activas, seis luces locales de muebles y cuatro radios reproduciendo en un cuarto. Las imágenes tienen texturas propias por instancia. Los GLB repetidos comparten geometría, con materiales separados; la caché libera modelos sin usuarios tras diez segundos para tolerar StrictMode y transiciones del editor. El cambio de cuarto desmonta la escena anterior. Movimiento reducido elimina bob, giro, flaps y desplazamientos decorativos; el panel también permite pausar las reacciones visuales.

## Archivos: responsabilidad, entrada y cambios

| Archivo creado o modificado | Responsabilidad y por qué existe | Recibe / cambia |
|---|---|---|
| `src/data/objects.json` | Registro común de los 24 tipos, dimensiones, acciones y configuración | Lo leen React y Flask; describe datos, no estado de juego |
| `src/data/furniture.js` | Conserva muebles antiguos y añade la colección | Une los catálogos; conserva el starter layout |
| `src/assets/interactive/*` | GLB preparados y imágenes iniciales extraídas | Recursos estáticos originales del ZIP con piezas separadas |
| `scripts/prepare_objects.py` | Importación reproducible y separación de triángulos por material/región con pivotes | ZIP → GLB con nodos semánticos + registro + imágenes iniciales |
| `src/App.jsx` | Conecta editor, objetos, red, audio y controles con la escena existente | items/room/live; mantiene selección, configuración recibida y opciones locales |
| `src/Furniture.jsx` | Transformación, selección y huella de una instancia | item/props; delega el dibujo y no modifica DB |
| `src/FurnitureModel.jsx` | Geometría de los muebles anteriores, reutilizada también en las miniaturas | tipo/estilo/presupuesto de luces; solo renderiza |
| `src/RoomUI.jsx` | Colección buscable y controles de decoración/acceso | selección/escala/visitas; invoca callbacks del editor |
| `src/roomLayout.js` | Huellas escaladas, colisiones y alfombra no bloqueante | registros; calcula, no guarda |
| `src/api.js` | Valida respuestas y realiza HTTP con cookie actual | JSON; devuelve datos o errores claros |
| `src/seating.js`, `src/SeatControls.jsx` | Asientos escalados y levantarse si desaparecen/cambian | muebles/posturas; reutilizan solicitudes de asiento existentes |
| `src/Player.jsx`, `src/RemotePlayer.jsx`, `src/PlayerAvatar.jsx` | Conservan movimiento/cámara/avatar y muestran poses/efectos/objetos en mano | postura del servidor; movimiento local publica posiciones |
| `src/objects/useObjectInteractions.js` | Suscripciones a actualizaciones y solicitudes con timeout | socket/registros; actualiza React tras respuesta del servidor |
| `src/objects/ObjectProximity.jsx` | Objeto cercano, E y detección de pisar alfombra | jugador/muebles; solo cambia el identificador contextual |
| `src/objects/ObjectPanel.jsx` | Uso/configuración, confirmación de portal y teclado del diálogo | objeto/rol; dispara acciones, guarda opciones y abre ampliación |
| `src/objects/ConfigEditor.jsx` | Formularios pequeños de luz, peces, poses, radio, portal y colección | configuración; produce configuración validable |
| `src/objects/ImageEditor.jsx`, `images.js` | Archivo/drop, preview, recorte y subida reutilizados | File/config; produce Blob optimizado y URL de almacenamiento |
| `src/objects/GuestPanels.jsx` | Pizarra y libro | aportaciones/revisión; envía dibujo/mensaje y conserva edición pendiente ante conflicto |
| `src/objects/DartsPanel.jsx` | Apuntar y lanzar tres veces | coordenadas; recibe puntuación calculada en Flask |
| `src/objects/InteractiveModel.jsx` | Clones de GLB, superficie de imagen y piezas animadas | item/config/state/jugadores; cambia únicamente transformaciones visuales temporales |
| `src/objects/ObjectEffects.jsx` | Partículas y personaje pequeño, con caducidad | efecto/fecha/semilla; monta y desmonta geometría temporal |
| `src/objects/SceneSurface.jsx` | Paisajes ligeros generados en canvas | paisaje; crea/dispose textura pequeña |
| `src/objects/RoomAudio.jsx` | Audio real de radio, ambiente sintetizado y cuac | estado compartido + permiso/volumen local; controla y limpia Audio/Web Audio |
| `src/objects/AvatarExtras.jsx` | Sombrero, gafas, corona, snack y caducidad | metadatos de postura; renderiza accesorios temporales |
| `src/objects/TouchMovement.jsx` | Flechas táctiles que usan el mismo cálculo WASD | ref de entrada; limpia botones al cancelar/desmontar |
| `src/objects/useReducedMotion.js`, `assets.js` | Preferencia de movimiento y URLs de imágenes iniciales | navegador/registro; listeners y referencias de recursos |
| `src/styles.css` | Paneles y estados táctiles dentro del estilo actual | clases; no introduce otro sistema visual |
| `backend/models.py` | scale/config/state/revision, acceso de habitación y metadatos de archivo | SQLAlchemy ↔ registros JSON |
| `backend/migrate_objects.py` | Ampliación explícita sin resetear datos | DB → backup de muebles → columnas/tablas nuevas |
| `backend/validation.py`, `object_config.py` | Transformaciones, claves, rangos, inventario y referencias de archivo válidas | entrada no confiable; produce datos limpios o rechaza |
| `backend/media.py` | Subidas reales, optimización, cuotas y entrega autorizada | multipart/cookie; crea archivo y fila de metadatos |
| `backend/objects.py` | Permisos, concurrencia, minijuego, mensajes, audio y efectos compartidos | HTTP/Socket.IO; guarda estado bajo bloqueo de fila |
| `backend/seating.py` | Reserva exclusiva y posición libre al levantarse | conexiones/muebles; cambia postura y libera ocupación |
| `backend/realtime.py` | Snapshot de objetos al entrar/reconectar | DB/conexión; emite estado inicial por el socket existente |
| `backend/app.py`, `visitors.py` | Registro de rutas, acceso a cuartos y preservación de aportaciones al guardar diseño | cookie/room/layout; aplica las reglas existentes más cierre a visitas |
| `backend/requirements.txt`, `.gitignore` | Pillow declarado; archivos de usuarios fuera del código fuente | configuración del proyecto |
| `tests/objects.test.js`, `backend/tests/test_objects.py`, `tests/browserObjects.mjs` | Comprobaciones de geometría, API real, permisos, dos conexiones y navegador | DB de pruebas y fixtures; nunca reinician habitaciones de desarrollo |

## Qué debes poder explicar

1. **Datos frente a objetos gráficos:** PostgreSQL guarda transformación/configuración; React reconstruye modelos. Una textura no es una foto en base64 dentro de una fila.
2. **Fuente de verdad:** los controles del navegador mejoran la experiencia; Flask decide quién puede escribir, qué acción existe, si está cerca y quién ocupa un asiento.
3. **Concurrencia:** `SELECT … FOR UPDATE` serializa cambios del objeto. Una revisión identifica la versión que se editó. El bloqueo de jugadores hace indivisible comprobar y ocupar un asiento.
4. **Tiempo compartido:** se transmiten inicio, final y semilla, no cada frame de una animación. `useFrame` calcula el estado visual local. La radio transmite pista/posición/fecha de actualización; cada navegador necesita permiso propio para emitir sonido.
5. **Limpieza:** los efectos se desmontan al caducar; los listeners y timers viven en efectos React con cleanup; audio se pausa y desconecta al salir; cada textura/material propio se libera y la geometría compartida se cuenta por usuarios.

Ejercicios para practicar después:

- Cambia la puntuación de los anillos de dardos y añade pruebas de sus bordes.
- Reescribe `imageCrop` y explica por qué contain reduce la superficie y cover recorta UVs.
- Añade una cuarta pose sencilla al asiento y mantén alineados registro, validación y avatar.
- Modifica el recorrido del pez conservando los límites del tanque y movimiento reducido.
- Implementa una vista de archivos sin usar y su borrado seguro, comprobando primero todas las referencias guardadas.

## Validación y conexiones pendientes

Se ejecutaron build, 35 pruebas frontend y 57 pruebas backend contra `social_rooms_test`. La prueba optativa de navegador cubre los 24 GLB/paneles, upload real de una fotografía, ampliación/restauración, visitante Socket.IO y acceso al archivo, asientos de dos conexiones, dibujo/libro, móvil, audio WAV real y liberación de partículas/audio.

La advertencia de Vite por el tamaño del bundle 3D sigue visible; no se ocultó. Los modelos GLB se solicitan bajo demanda, pero Three.js/Drei todavía forman un bundle principal grande.

**Identidad:** sigue el sistema temporal por nombre. Es posible entrar con el mismo nombre y reclamar la misma habitación; no existe autenticación real. Las comprobaciones de propietario se ejecutan en el servidor con esa identidad de pruebas, no constituyen seguridad de cuentas para un lanzamiento público.

No faltan credenciales externas para estos objetos. El almacenamiento es el disco de este Mac, no un servicio cloud. Música: archivos propios, sin integración musical externa. Voz/pantalla mantienen el WebRTC anterior; un TURN externo, si resulta necesario en otras redes, sigue configurándose mediante `VOICE_ICE_SERVERS`. El servidor mantiene un único proceso Socket.IO para las reservas actuales; escalar a varios workers requerirá coordinar presencia/asientos con un almacenamiento compartido.
