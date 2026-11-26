/**
 * Sends the billing contact of an invoice an email.
 */
public with sharing class EmailNotifier implements InvoiceNotifier {
    public void send(Invoice__c invoice) {
        Messaging.SingleEmailMessage message = new Messaging.SingleEmailMessage();
        message.setTargetObjectId(invoice.Billing_Contact__c);
        message.setSubject('Invoice ' + invoice.Name);
        String body = 'Late_Fee__c is added after ' + InvoiceEvents.graceDays() + ' days.';
        message.setPlainTextBody(body);
        Messaging.sendEmail(new List<Messaging.SingleEmailMessage>{ message });
    }

    public String channel() {
        return 'Email';
    }
}
