function classifyEmail(subject, body) {
  var text = (subject + ' ' + body).toLowerCase();

  var category = 'general';
  var urgency = 'low';

  if (text.match(/appointment|booking|schedule|visit|consult|doctor|opd/)) {
    category = 'appointment';
    urgency = 'medium';
  } else if (text.match(/bill|payment|invoice|receipt|insurance|amount|due|charge/)) {
    category = 'billing';
    urgency = 'medium';
  } else if (text.match(/lab|report|test|result|blood|urine|scan|xray|x-ray|mri|ct scan/)) {
    category = 'lab-report';
    urgency = 'high';
  } else if (text.match(/patient|admission|discharge|medicine|treatment|surgery|doctor|health|symptom|pain/)) {
    category = 'patient-inquiry';
    urgency = 'medium';
  }

  if (text.match(/urgent|emergency|critical|immediately|asap|serious/)) {
    urgency = 'high';
  }

  return { category: category, urgency: urgency, summary: subject };
}

function draftReply(email, classification) {
  var senderName = email.from.replace(/<.*>/, '').trim() || 'Sir/Madam';

  var templates = {
    'appointment': 'Dear ' + senderName + ',\n\nThank you for reaching out to Hope Hospital.\n\nWe have received your appointment request. Kindly contact our reception at the earliest to confirm your appointment slot.\n\nFor appointments, please call us directly so we can schedule you at the most convenient time.\n\nWarm regards,\nHope Hospital Team',

    'billing': 'Dear ' + senderName + ',\n\nThank you for contacting Hope Hospital regarding your billing query.\n\nWe have noted your concern and our billing team will review your account and get back to you shortly. If you require immediate assistance, please visit our billing desk during working hours.\n\nWarm regards,\nHope Hospital Team',

    'lab-report': 'Dear ' + senderName + ',\n\nThank you for contacting Hope Hospital.\n\nRegarding your lab report inquiry, please contact our laboratory department directly. Our lab team will assist you with your reports and results.\n\nFor urgent reports, you may visit the lab counter during working hours.\n\nWarm regards,\nHope Hospital Team',

    'patient-inquiry': 'Dear ' + senderName + ',\n\nThank you for reaching out to Hope Hospital.\n\nWe have received your inquiry. For medical advice and treatment-related questions, we recommend consulting with our doctors directly. Please call us or visit the hospital for a proper consultation.\n\nOur team is here to help you.\n\nWarm regards,\nHope Hospital Team',

    'general': 'Dear ' + senderName + ',\n\nThank you for contacting Hope Hospital.\n\nWe have received your message and our team will get back to you shortly. If your matter is urgent, please do not hesitate to call us directly.\n\nWarm regards,\nHope Hospital Team'
  };

  return templates[classification.category] || templates['general'];
}
/
