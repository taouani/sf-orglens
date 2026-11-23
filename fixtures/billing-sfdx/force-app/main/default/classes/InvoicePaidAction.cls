/**
 * An action a flow can call. The class names no field and no object: what it does is in InvoiceService.
 */
public with sharing class InvoicePaidAction {
    @InvocableMethod(label='Mark Invoices Paid' description='Marks each of the invoices as paid.')
    public static void markPaid(List<Id> invoiceIds) {
        for (Id invoiceId : invoiceIds) {
            InvoiceService.markPaid(invoiceId);
        }
    }
}
