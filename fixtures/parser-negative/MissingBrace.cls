/**
 * Does not compile: the method "second" never closes. A parser that recovers still finds "third".
 */
public with sharing class MissingBrace {
    public static Decimal first(Invoice__c invoice) {
        return invoice.Amount__c;
    }

    public static void second(Invoice__c invoice) {
        if (invoice.Status__c == 'Paid') {
            invoice.Paid_Date__c = Date.today();

    public static Decimal third(Invoice__c invoice) {
        return invoice.Tax_Rate__c;
    }
}
