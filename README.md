# Sorteo para Meet

Extensión de Chrome (también funciona en Edge) para sortear entre las personas que están en tu reunión de Google Meet. Pensada para decidir quién presenta, pero el título es configurable.

## Instalación

1. Descomprimí la carpeta `sorteo-meet`.
2. En Chrome abrí `chrome://extensions` y activá **Modo de desarrollador** (arriba a la derecha).
3. Tocá **Cargar descomprimida** y elegí la carpeta `sorteo-meet`.
4. Opcional: fijá la extensión con el ícono del rompecabezas de la barra de Chrome.

## Cómo se usa

1. Entrá a tu reunión en `meet.google.com`.
2. Tocá el botón **Sorteo** (el círculo violeta con un dado) de la barra de abajo de Meet, junto a «Presentar ahora». También podés usar el ícono de la extensión. Se abre la ventana del **Sorteo** y trae automáticamente a los que están en la reunión.
3. **Para que todos lo vean**, en Meet tocá **Presentar ahora → Una ventana** y elegí la ventana «Sorteo». Si no presentás la ventana, solo lo ves vos.
4. Tocá **Girar la ruleta** (o **Tirar de la palanca** si hay más de 8 personas).
5. Tocá **Anunciar en el chat** para que el resultado quede escrito en la reunión. El chat queda abierto y el botón se bloquea («Anunciado ✓») para no anunciar dos veces; con un sorteo nuevo se habilita otra vez.

En el resultado se muestra la **foto de perfil** de cada ganador, si Meet la tiene; si no, sus iniciales. La foto se lee de la lista de Meet y no se guarda ni se envía a ningún lado.

Cada persona de la lista tiene un casillero: desmarcá a quien no participa (por ejemplo, alguien que solo escucha). Si falta alguien, agregalo a mano con «Agregar a mano».

## Configuración (engranaje)

| Opción | Qué hace |
| --- | --- |
| Título del sorteo | El texto que se ve en la ventana, en el resultado y en el chat. |
| Cantidad de ganadores | Un número que escribís vos. Cada puesto tiene su nombre editable («Primer lugar», «Presenta», «Suplente»…). |
| No repetir ganadores anteriores | Desactivado por defecto. Quien ya ganó queda fuera hasta que borres el historial. |
| Apariencia | Automática (sigue el modo claro/oscuro de tu sistema), Clara u Oscura. Se ve al instante y se guarda con «Guardar». |
| Mostrar el botón «Sorteo» en la barra de Meet | Activado por defecto. Si te molesta, desactivalo y abrí el sorteo con el ícono de la extensión. |
| Anunciar en el chat al terminar | Desactivado por defecto. Escribe el resultado solo. |

Con varios ganadores, la ruleta (o la tragamonedas) gira una vez por puesto, y quien sale queda fuera del giro siguiente: nadie gana dos puestos.

Con 1 a 3 ganadores el resultado se muestra como podio; con más, como lista.

## Qué hace con tus datos

Nada sale de tu navegador. La configuración y el historial se guardan en tu propio Chrome (`chrome.storage.local`). La extensión solo lee los nombres de los participantes y escribe en el chat cuando se lo pedís desde la ventana del sorteo. No usa servidores ni analítica.

El azar usa `crypto.getRandomValues` con rechazo de sesgo: todas las personas tienen la misma probabilidad.

## Si algo no anda

Meet cambia su pantalla seguido y la extensión no tiene una API oficial para leer participantes ni escribir en el chat, así que esas dos funciones son de «mejor esfuerzo»:

- **No trae a los participantes:** abrí el panel **Personas** de Meet y tocá **Actualizar**. Si no alcanza, agregalos a mano; el resto del sorteo funciona igual.
- **No puede escribir en el chat:** el chat de Meet es un marco de Google Chat (`chat.google.com`); por eso la extensión pide permiso sobre ese sitio, solo dentro de Meet.  copia el mensaje al portapapeles; pegalo con Ctrl+V.
- **No aparece el botón en la barra:** Meet cambia su diseño y el botón se ubica de forma aproximada. Recargá la pestaña; si sigue sin verse, usá el ícono de la extensión (siempre funciona). Revisá también que esté activado en Configuración.
- **Instalaste la extensión con la reunión ya abierta:** tocá el ícono una vez (la extensión se conecta sola) o recargá la pestaña de Meet.
- **«No pude conectar con la pestaña de Meet»:** recargá Meet (F5) y volvé a abrir el sorteo.

Si Meet cambia y deja de funcionar la lectura, todos los selectores están en `content.js` (funciones `readFromPanel`, `readFromTiles`, `findChatInput`, `BAR_ANCHORS`), pensados para ajustarse fácilmente.

## Para desarrolladores

```
manifest.json     Manifest V3
chat-frame.js     Corre dentro del marco de Google Chat que Meet incrusta en su chat: escribe y envía el mensaje
background.js     Abre la ventana del sorteo (ícono o botón de la barra)
content.js        Se ejecuta en Meet: botón de la barra, lee participantes y escribe en el chat
lib.js            Lógica pura (azar, puestos, mensaje, ruleta, tragamonedas)
sorteo.html/css/js  La ventana del sorteo
tests/            Pruebas: node --test tests/lib.test.js tests/background.test.js
```
