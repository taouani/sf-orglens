/**
 * Gives the owner of an invoice a task.
 */
public with sharing class TaskNotifier implements InvoiceNotifier {
    public void send(Invoice__c invoice) {
        insert new Task(WhatId = invoice.Id, OwnerId = invoice.OwnerId, Subject = 'Follow up ' + invoice.Name);
    }

    public String channel() {
        return 'Task';
    }
}
