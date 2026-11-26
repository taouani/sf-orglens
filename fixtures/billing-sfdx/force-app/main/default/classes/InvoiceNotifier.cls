/**
 * Tells someone about an invoice.
 */
public interface InvoiceNotifier {
    void send(Invoice__c invoice);

    String channel();
}
