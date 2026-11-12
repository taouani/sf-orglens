/**
 * Voids invoices that are long overdue. Has an inner class and keeps state between batches.
 */
public with sharing class InvoiceBatch implements Database.Batchable<SObject>, Database.Stateful {
    public class Result {
        public Integer processed = 0;
        public Decimal overdueAmount = 0;

        public void add(Invoice__c invoice) {
            processed++;
            overdueAmount += invoice.Grand_Total__c;
        }
    }

    private Result result = new Result();

    public Database.QueryLocator start(Database.BatchableContext context) {
        return Database.getQueryLocator([
            SELECT Id, Grand_Total__c, Days_Overdue__c,
                Account__r.Primary_Contact__r.Email
            FROM Invoice__c
            WHERE Days_Overdue__c > 30
        ]);
    }

    public void execute(Database.BatchableContext context, List<Invoice__c> scope) {
        for (Invoice__c invoice : scope) {
            if (invoice.Days_Overdue__c > 90) {
                invoice.Status__c = 'Void';
            }
            result.add(invoice);
        }
        update scope;
    }

    public void finish(Database.BatchableContext context) {
        System.debug(LoggingLevel.INFO, result.processed + ' invoices, ' + result.overdueAmount);
    }
}
