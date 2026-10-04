/* eslint-disable */
// Prints SHQueryUserNotificationState (5 = normal, 2/3/4 = fullscreen/presenting). Windows only.
const k = require('koffi');
const f = k.load('shell32.dll').func('long __stdcall SHQueryUserNotificationState(_Out_ int *s)');
const o = [0];
f(o);
console.log('QUNS', o[0]);
