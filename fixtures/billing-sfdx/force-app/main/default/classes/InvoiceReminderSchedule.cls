/**
 * Starts the reminders of the invoices that are overdue, each time it is scheduled.
 */
public with sharing class InvoiceReminderSchedule implements Schedulable {
    public void execute(SchedulableContext context) {
        Set<Id> overdue = new Map<Id, Invoice__c>([SELECT Id FROM Invoice__c WHERE Days_Overdue__c > 0]).keySet();
        System.enqueueJob(new InvoiceReminderJob(overdue));
    }
}
