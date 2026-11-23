export const eventMessages = {
    NOT_FOUND: 'Event not found.',
    QUOTA_REACHED: 'You have used all the events in your quota.',
    WINDOW_ORDER: 'closesAt must be after opensAt.',
    WINDOW_TOO_LONG: 'The upload window is too long.',
    GEOFENCE_NEEDS_LOCATION: 'Turning on the location limit needs latitude and longitude.',
    INVALID_TIMEZONE: 'Unknown time zone.',
    SUSPENDED: 'This event is suspended.',
    QR_NOT_ACTIVE: 'The QR is activated once your package is confirmed.',
    PACKAGE_STEP: 'The package must be a multiple of 25 guests.',
} as const;
