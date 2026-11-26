/**
 * Sends the notices of an invoice through each notifier, and finds a notifier by the name of its class.
 */
public with sharing class InvoiceNotifications {
    private List<InvoiceNotifier> notifiers = new List<InvoiceNotifier>();

    public InvoiceNotifications() {
        notifiers.add(new EmailNotifier());
        notifiers.add(new TaskNotifier());
    }

    public InvoiceNotifications(List<InvoiceNotifier> notifiers) {
        this.notifiers.addAll(notifiers);
    }

    public void sendAll(Invoice__c invoice) {
        for (InvoiceNotifier notifier : notifiers) {
            notifier.send(invoice);
        }
    }

    public static InvoiceNotifier defaultNotifier() {
        return (InvoiceNotifier) Type.forName('EmailNotifier').newInstance();
    }

    public static InvoiceNotifier byName(String className) {
        return (InvoiceNotifier) Type.forName(className).newInstance();
    }
}
