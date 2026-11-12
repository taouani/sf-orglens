/**
 * Does not compile: the query has no field list and the statement after it has no end.
 */
public with sharing class BrokenQuery {
    public static List<Invoice__c> broken() {
        return [SELECT FROM Invoice__c WHERE Status__c = ];
    }

    public static Decimal after(Invoice__c invoice) {
        Decimal amount = invoice.Amount__c
        return amount;
    }
}
