/**
 * Does not compile: a text literal is never closed, and a block comment runs to the end of the file.
 */
public with sharing class UnclosedString {
    public static String label(Invoice__c invoice) {
        String prefix = 'Invoice ;
        return prefix + invoice.Name;
    }

    public static Decimal amount(Invoice__c invoice) {
        return invoice.Amount__c;
    }
    /* This comment is never closed.
}
