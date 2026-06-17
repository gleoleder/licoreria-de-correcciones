// ═══════════════════════════════════════════════════════
//  POS Licorería v3 — Configuración
//  Editar con cualquier editor de texto (Notepad, VS Code)
// ═══════════════════════════════════════════════════════
//
//  SHEETS_ID        → ID del Google Sheet (base de datos en la nube)
//                     URL: https://docs.google.com/spreadsheets/d/ [AQUI] /edit
//
//  SHEETS_API_KEY   → Clave de API de Google Cloud (solo lectura)
//                     Google Cloud Console → APIs → Credenciales → Clave de API
//                     Habilitar: "Google Sheets API"
//
//  APPS_SCRIPT_URL  → URL del Google Apps Script desplegado como Web App
//                     Apps Script → Implementar → Nueva implementación → Aplicación web
//                     Ejecutar como: Yo | Acceso: Cualquier usuario
// ───────────────────────────────────────────────────────

var SHEETS_ID       = '1L13a3OM7PCCUGvYTanHofM1EuOPaJ0a99_V1zR0W45w';
var SHEETS_API_KEY  = 'AIzaSyAOhGTjJXHhuUhqf1g2DPCla59xNzftb-Q';
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw9OmOV1B8YaIaOJ9QkIilL5YW6dwGkKYim5M9MGqG5gLcxHh4lkLsuB_s3JXUA2w/exec';

// ═══════════════════════════════════════════════════════
//  CUENTAS Y ROLES (§8-bis)
//  ⚠️ Control de conveniencia (UX), NO de seguridad real.
//     Cambia las contraseñas antes de usar en producción.
// ═══════════════════════════════════════════════════════
var CUENTAS = [
  { user: 'MIUSHA', pass: 'NeOs1552',     rol: 'admin',    nombre: 'MIUSHA' },
  { user: 'cajero', pass: 'CAMBIAR_CAJA', rol: 'empleado', nombre: 'Cajero' }
];

// Qué pestañas puede ver cada rol
var PERMISOS = {
  admin:    ['pos', 'productos', 'categorias', 'inventario', 'ventas', 'estadisticas'],
  empleado: ['pos', 'productos']
};
