import { Resend } from 'resend';
import logger from './logger';

const resend = new Resend(process.env.RESEND_API_KEY);



// --------------------
// Utils
// --------------------
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeString(input: string): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, 5000);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --------------------
// Validación
// --------------------
export function validateAndSanitize(data: any) {
  const errors: string[] = [];

  if (!data.source || !['vehicle', 'contact', 'vestri'].includes(data.source)) {
    errors.push('Source inválido');
  }

  if (!data.name || data.name.trim().length < 2) {
    errors.push('Nombre requerido');
  }

  if (!data.phone || data.phone.trim().length < 8) {
    errors.push('Teléfono requerido');
  }

  if (data.source !== 'vestri') {
    if (!data.email || !isValidEmail(data.email)) {
      errors.push('Email válido requerido');
    }
  } else if (data.email && !isValidEmail(data.email)) {
    errors.push('Email inválido');
  }

  if (!data.message || data.message.trim().length < 5) {
    errors.push('Mensaje requerido');
  }

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }

  return {
    valid: true,
    errors: [],
    data: {
      source: data.source,
      name: sanitizeString(data.name),
      email: data.email ? sanitizeString(data.email) : '',
      phone: sanitizeString(data.phone),
      message: sanitizeString(data.message),
      vehicle: data.vehicle || null,
    },
  };
}

function resolveRecipient(source: string): string {
  switch (source) {
    case 'vestri':
      return process.env.EMAIL_TO_VESTRI!;
    case 'vehicle':
      return process.env.EMAIL_TO_VEHICLE!;
    case 'contact':
    default:
      return process.env.EMAIL_TO_CONTACT!;
  }
}


// --------------------
// Formato HTML (COMPLETO)
// --------------------
function formatEmailContent(data: any) {
  const sourceNames: Record<string, string> = {
    vehicle: 'Consulta desde Detalle de Vehículo',
    contact: 'Consulta desde Página de Contacto',
    vestri: 'Consulta desde Vestri',
  };

  const theme = data.source === 'vestri'
    ? {
        header: '#2563eb',      // azul
        accent: '#2563eb',
        vehicleBg: '#eff6ff',
      }
    : {
        header: '#f97316',      // naranja
        accent: '#f97316',
        vehicleBg: '#fff7ed',
      };

  const subject = `[CAR ADVICE] ${sourceNames[data.source]}`;
  const safeMessage = escapeHtml(data.message).replace(/\n/g, '<br/>');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, sans-serif; background:#f3f4f6; color:#111827; }
    .container { max-width:600px; margin:20px auto; background:#ffffff; border-radius:8px; overflow:hidden; }
    .header { background:${theme.header}; color:#fff; padding:20px; text-align:center; }
    .content { padding:20px; }
    .field { margin-bottom:14px; }
    .label { font-weight:bold; color:#374151; }
    .value { background:#f9fafb; padding:8px; border-radius:4px; }
    .vehicle { margin-top:20px; padding:15px; background:${theme.vehicleBg}; border-left:4px solid ${theme.accent}; }
    .footer { font-size:12px; color:#6b7280; text-align:center; padding:15px; border-top:1px solid #e5e7eb; }
    a { color:${theme.accent}; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${sourceNames[data.source]}</h2>
    </div>
    <div class="content">
      <div class="field"><div class="label">Nombre</div><div class="value">${escapeHtml(data.name)}</div></div>

      ${data.email ? `
      <div class="field">
        <div class="label">Email</div>
        <div class="value"><a href="mailto:${data.email}">${data.email}</a></div>
      </div>` : ''}

      <div class="field">
        <div class="label">Teléfono</div>
        <div class="value"><a href="tel:${data.phone}">${data.phone}</a></div>
      </div>

      <div class="field">
        <div class="label">Mensaje</div>
        <div class="value">${safeMessage}</div>
      </div>

      ${data.vehicle ? `
      <div class="vehicle">
        <h3>Información del Vehículo</h3>
        <div class="field"><div class="label">Vehículo</div><div class="value"><strong>${data.vehicle.title || 'N/A'}</strong></div></div>
        ${data.vehicle.price ? `
        <div class="field">
          <div class="label">Precio</div>
          <div class="value">${data.vehicle.priceCurrency === 'USD' ? 'U$' : '$'}${Number(data.vehicle.price).toLocaleString('es-AR')}</div>
        </div>` : ''}
        ${data.vehicle.url ? `<a href="${data.vehicle.url}" target="_blank">Ver vehículo</a>` : ''}
      </div>` : ''}
    </div>
    <div class="footer">
      Enviado desde el formulario web de CAR ADVICE<br/>
      ${new Date().toLocaleString('es-AR')}
    </div>
  </div>
</body>
</html>
`;

  return { subject, html };
}


// --------------------
// Envío
// --------------------
export async function sendLeadEmail(data: any): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY no configurada');
  }

  if (!process.env.EMAIL_FROM) {
    throw new Error('EMAIL_FROM no configurado');
  }

  const { subject, html } = formatEmailContent(data);
  const to = resolveRecipient(data.source);

  const response = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    replyTo: data.email || undefined,
  });
  
  if (response.error) {
    logger.error('Error enviando email con Resend', {
      error: response.error,
      source: data.source,
      to,
    });
    throw new Error('No se pudo enviar el email');
  }
  
  logger.info('Email enviado con Resend', {
    id: response.data?.id,
    source: data.source,
    to,
  });
  


}

