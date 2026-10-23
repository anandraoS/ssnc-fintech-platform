package com.fintechdemo.platform.common;

/** Masking helpers so sensitive values never reach logs or reduced-privilege API views. */
public final class Masking {

    private Masking() {
    }

    public static String email(String email) {
        if (email == null) {
            return null;
        }
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***" + (at >= 0 ? email.substring(at) : "");
        }
        return email.charAt(0) + "***" + email.substring(at);
    }

    public static String phone(String phone) {
        if (phone == null || phone.length() < 4) {
            return phone == null ? null : "***";
        }
        return "***" + phone.substring(phone.length() - 2);
    }

    /** Keeps the prefix and the last 4 characters, e.g. ACC-******0001. */
    public static String accountNumber(String number) {
        if (number == null || number.length() <= 8) {
            return number == null ? null : "****";
        }
        return number.substring(0, 4) + "*".repeat(number.length() - 8) + number.substring(number.length() - 4);
    }
}
